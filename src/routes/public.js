const path = require('path');
const express = require('express');
const db = require('../db');
const { checkAccess, consumeDownload } = require('../lib/access');
const { hashToken } = require('../lib/tokens');
const { signOtpSession } = require('../lib/otpSession');
const { requestOtp, verifyOtp } = require('../services/otp');
const { downloadLimiter, otpRequestLimiter, otpVerifyLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const sHtmlPath = path.resolve(process.cwd(), 'public', 's.html');

// Helper to find OTP session cookie for any share or specific share
function getOtpSessionCookie(req, shareId) {
  if (!req.cookies) return null;
  if (shareId) {
    return req.cookies[`otp_${shareId}`] || null;
  }
  const otpKey = Object.keys(req.cookies).find((k) => k.startsWith('otp_'));
  return otpKey ? req.cookies[otpKey] : null;
}

// GET /s/:token (Recipient landing page)
// Never reveals whether the token exists or not
router.get('/:token', (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(sHtmlPath);
});

// POST /s/:token/otp/request
// Always returns 200 "If this email is allowed, a code was sent" to prevent recipient enumeration
router.post('/:token/otp/request', otpRequestLimiter, async (req, res) => {
  const token = req.params.token;
  const email = req.body?.email;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const defaultMsg = { message: 'If this email is allowed, a code was sent' };

  if (!token || !email) {
    return res.status(200).json(defaultMsg);
  }

  const tokenHash = hashToken(token);
  const share = db
    .prepare('SELECT id, expires_at, revoked_at, restricted FROM shares WHERE token_hash = ?')
    .get(tokenHash);

  if (!share || share.revoked_at != null || Date.now() > share.expires_at) {
    return res.status(200).json(defaultMsg);
  }

  try {
    await requestOtp(share.id, email, { ip, userAgent });
  } catch (err) {
    // Keep response generic on internal failures
  }

  return res.status(200).json(defaultMsg);
});

// POST /s/:token/otp/verify
// On success sets signed httpOnly cookie otp_<shareId>. On failure returns generic 400 error.
router.post('/:token/otp/verify', otpVerifyLimiter, (req, res) => {
  const token = req.params.token;
  const email = req.body?.email;
  const code = req.body?.code;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  const genericError = { error: 'Invalid or expired verification code' };

  if (!token || !email || !code) {
    return res.status(400).json(genericError);
  }

  const tokenHash = hashToken(token);
  const share = db
    .prepare('SELECT id, expires_at, revoked_at, restricted FROM shares WHERE token_hash = ?')
    .get(tokenHash);

  if (!share || share.revoked_at != null || Date.now() > share.expires_at) {
    return res.status(400).json(genericError);
  }

  const result = verifyOtp(share.id, email, code, { ip, userAgent });

  if (!result || !result.ok) {
    return res.status(400).json(genericError);
  }

  // Generate signed OTP session JWT
  const otpSessionToken = signOtpSession({
    shareId: share.id,
    email: result.email,
    shareExpiresAt: share.expires_at,
    ip,
  });

  const isSecure = req.secure || process.env.NODE_ENV === 'production';

  res.cookie(`otp_${share.id}`, otpSessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 30 * 60 * 1000,
  });

  return res.status(200).json({ ok: true, message: 'Verified' });
});

// POST /s/:token/download
router.post('/:token/download', downloadLimiter, async (req, res) => {
  const token = req.params.token;
  const password = req.body?.password;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';

  let shareId = null;
  if (token) {
    const tokenHash = hashToken(token);
    const row = db.prepare('SELECT id FROM shares WHERE token_hash = ?').get(tokenHash);
    if (row) {
      shareId = row.id;
    }
  }

  const otpSession = getOtpSessionCookie(req, shareId);

  try {
    const access = checkAccess({
      token,
      otpSession,
      password,
      ip,
      userAgent,
    });

    if (!access.ok) {
      // Identical generic error response for every failure
      return res.status(404).json({ error: 'unavailable' });
    }

    const download = await consumeDownload({
      shareId: access.share.id,
      email: access.email,
      ip,
      userAgent,
    });

    // 4 Mandatory download headers per ARCHITECTURE.md section 9 + RFC 5987 / 6266 UTF-8 support
    const originalName = download.originalName || 'file.bin';
    const asciiFallback = originalName.replace(/[^\x20-\x7E]/g, '_').replace(/["\r\n\\]/g, '_');
    const encodedFilename = encodeURIComponent(originalName);

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).send(download.buffer);
  } catch (err) {
    if (shareId && (err.message === 'LIMIT' || err.message === 'REVOKED' || err.message === 'EXPIRED')) {
      try {
        const share = db
          .prepare('SELECT s.id, f.owner_id FROM shares s JOIN files f ON s.file_id = f.id WHERE s.id = ?')
          .get(shareId);
        if (share) {
          const { notify } = require('../services/notifier');
          db.prepare(
            `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`
          ).run(shareId, null, ip || null, userAgent || null, err.message, Date.now());
          notify(share.owner_id, shareId, err.message, `Blocked access attempt (${err.message})`, Date.now());
        }
      } catch (logErr) {
        // ignore logging error
      }
    }
    // If decryption or access fails, never reveal internal details or partial bytes
    return res.status(404).json({ error: 'unavailable' });
  }
});

module.exports = router;
