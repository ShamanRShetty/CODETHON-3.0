const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { sendOtpMail } = require('./mailer');

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
    logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'BAD_OTP');
    return { ok: false, reason: 'BAD_OTP' };
  }

  // Check if code was already locked (max 5 attempts reached)
  if (otpRow.attempts >= 5) {
    logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'OTP_LOCKED');
    return { ok: false, reason: 'OTP_LOCKED' };
  }

  // Check if code has expired (5-minute window)
  const now = Date.now();
  if (now > otpRow.expires_at) {
    logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'BAD_OTP');
    return { ok: false, reason: 'BAD_OTP' };
  }

  // Calculate HMAC of input code and timing-safe comparison
  const candidateHash = hashOtpCode(normalizedCode);
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const storedBuf = Buffer.from(otpRow.code_hash, 'hex');

  const isMatch = candidateBuf.length === storedBuf.length && crypto.timingSafeEqual(candidateBuf, storedBuf);

  if (!isMatch) {
    // Increment attempts on incorrect code
    const newAttempts = otpRow.attempts + 1;
    db.prepare('UPDATE otp_codes SET attempts = ? WHERE id = ?').run(newAttempts, otpRow.id);

    if (newAttempts >= 5) {
      logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'OTP_LOCKED');
      return { ok: false, reason: 'OTP_LOCKED' };
    }

    logOtpFailure(shareId, normalizedEmail, ip, userAgent, 'BAD_OTP');
    return { ok: false, reason: 'BAD_OTP' };
  }

  // Code is valid: mark as used (single use)
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRow.id);

  return {
    ok: true,
    shareId,
    email: normalizedEmail,
  };
}

module.exports = {
  requestOtp,
  verifyOtp,
  generateOtp: requestOtp,
};
