const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { sendOtpMail } = require('./mailer');
const { notify } = require('./notifier');

function getOtpSecret() {
  return process.env.OTP_SECRET || config.OTP_SECRET;
}

function hashOtpCode(code) {
  const secret = getOtpSecret();
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

function logOtpFailure(shareId, email, ip, userAgent, reason) {
  try {
    const now = Date.now();
    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    ).run(shareId, email || null, ip || null, userAgent || null, reason, now);

    if (shareId) {
      const share = db
        .prepare('SELECT s.id, f.owner_id FROM shares s JOIN files f ON s.file_id = f.id WHERE s.id = ?')
        .get(shareId);
      if (share && share.owner_id) {
        notify(
          share.owner_id,
          shareId,
          reason,
          `Blocked OTP attempt (${reason}): ${email || 'unknown'} from ${ip || 'unknown IP'}`,
          now
        );
      }
    }
  } catch (err) {
    console.error('[OTP Service] Failed to log failure:', err.message);
  }
}

/**
 * Request an OTP for a restricted share.
 * Generates a 6-digit random code, stores HMAC hash with 5-minute expiry,
 * invalidates previous unused codes, and sends via mailer if on recipient list.
 * Always returns identical generic success message to prevent recipient enumeration.
 *
 * @param {number} shareId
 * @param {string} email
 * @param {Object} [options]
 * @param {string} [options.ip]
 * @param {string} [options.userAgent]
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function requestOtp(shareId, email, { ip, userAgent } = {}) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  const genericResponse = { ok: true, message: 'If this email is allowed, a code was sent' };

  if (!shareId || !normalizedEmail) {
    return genericResponse;
  }

  // Check if recipient is on the allowed list for this share
  const recipient = db
    .prepare('SELECT id FROM share_recipients WHERE share_id = ? AND email = ?')
    .get(shareId, normalizedEmail);

  if (!recipient) {
    // Record stranger access attempt per PRD D-02
    logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'NOT_ON_LIST');
    return genericResponse;
  }

  // Invalidate any older unused codes for this share and email
  db.prepare('UPDATE otp_codes SET used = 1 WHERE share_id = ? AND email = ? AND used = 0').run(
    shareId,
    normalizedEmail
  );

  // Generate 6-digit secure numeric code
  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = hashOtpCode(code);
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  // Store hashed OTP code
  db.prepare(
    `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
     VALUES (?, ?, ?, ?, 0, 0)`
  ).run(shareId, normalizedEmail, codeHash, expiresAt);

  // Send code to recipient email
  await sendOtpMail({ to: normalizedEmail, code, shareId });

  return genericResponse;
}

/**
 * Verify an OTP code for a restricted share.
 * Validates HMAC hash with timingSafeEqual, enforces 5-minute expiry,
 * tracks failed attempts up to 5, logs BAD_OTP/OTP_LOCKED, and marks as single use.
 *
 * @param {number} shareId
 * @param {string} email
 * @param {string|number} code
 * @param {Object} [options]
 * @param {string} [options.ip]
 * @param {string} [options.userAgent]
 * @returns {{ ok: boolean, reason?: string, shareId?: number, email?: string }}
 */
function verifyOtp(shareId, email, code, { ip, userAgent } = {}) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  const normalizedCode = (code !== undefined && code !== null ? String(code) : '').trim();

  if (!shareId || !normalizedEmail || !normalizedCode) {
    if (shareId) {
      logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'BAD_OTP');
    }
    return { ok: false, reason: 'BAD_OTP' };
  }

  let verifyResult = { ok: false, reason: 'BAD_OTP' };

  const tx = db.transaction(() => {
    // Find latest unused OTP row for this share and email
    const otpRow = db
      .prepare(
        `SELECT id, share_id, email, code_hash, expires_at, attempts, used
         FROM otp_codes
         WHERE share_id = ? AND email = ? AND used = 0
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(shareId, normalizedEmail);

    if (!otpRow) {
      verifyResult = { ok: false, reason: 'BAD_OTP' };
      return;
    }

    // Check if code was already locked (max 5 attempts reached)
    if (otpRow.attempts >= 5) {
      verifyResult = { ok: false, reason: 'OTP_LOCKED' };
      return;
    }

    // Check if code has expired (5-minute window)
    const now = Date.now();
    if (now > otpRow.expires_at) {
      verifyResult = { ok: false, reason: 'BAD_OTP' };
      return;
    }

    // Calculate HMAC of input code and timing-safe comparison
    const candidateHash = hashOtpCode(normalizedCode);
    const candidateBuf = Buffer.from(candidateHash, 'hex');
    const storedBuf = Buffer.from(otpRow.code_hash, 'hex');

    const isMatch =
      candidateBuf.length === storedBuf.length && crypto.timingSafeEqual(candidateBuf, storedBuf);

    if (!isMatch) {
      // Increment attempts atomically in SQL
      db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otpRow.id);
      const updatedRow = db.prepare('SELECT attempts FROM otp_codes WHERE id = ?').get(otpRow.id);

      if (updatedRow && updatedRow.attempts >= 5) {
        verifyResult = { ok: false, reason: 'OTP_LOCKED' };
      } else {
        verifyResult = { ok: false, reason: 'BAD_OTP' };
      }
      return;
    }

    // Code is valid: mark as used (single use)
    db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRow.id);

    verifyResult = {
      ok: true,
      shareId,
      email: normalizedEmail,
    };
  });

  tx();

  if (!verifyResult.ok) {
    logOtpFailure(shareId, normalizedEmail, ip, userAgent, verifyResult.reason);
  }

  return verifyResult;
}

module.exports = {
  requestOtp,
  verifyOtp,
  generateOtp: requestOtp,
};
