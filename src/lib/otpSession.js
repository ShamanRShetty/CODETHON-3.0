const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

function getOtpSecret() {
  return process.env.OTP_SECRET || config.OTP_SECRET;
}

/**
 * Sign an OTP session JWT for a verified recipient.
 * Expiry is min(30 minutes, time until share expires).
 *
 * @param {Object} params
 * @param {number} params.shareId
 * @param {string} params.email
 * @param {number} [params.shareExpiresAt]
 * @param {string} [params.ip]
 * @returns {string} JWT token
 */
function signOtpSession({ shareId, email, shareExpiresAt, ip }) {
  const secret = getOtpSecret();
  const normalizedEmail = (email || '').toLowerCase().trim();

  const maxSessionSeconds = 30 * 60; // 30 minutes
  let expirySeconds = maxSessionSeconds;

  if (shareExpiresAt) {
    const msUntilShareExpiry = shareExpiresAt - Date.now();
    const secUntilShareExpiry = Math.floor(msUntilShareExpiry / 1000);
    expirySeconds = Math.max(1, Math.min(maxSessionSeconds, secUntilShareExpiry));
  }

  const ipHash = ip ? crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16) : null;

  return jwt.sign(
    {
      shareId,
      email: normalizedEmail,
      ipHash,
    },
    secret,
    { expiresIn: expirySeconds }
  );
}

/**
 * Verify an OTP session JWT.
 * Returns decoded payload { shareId, email } if valid and matches expected shareId and IP, else null.
 *
 * @param {string} token
 * @param {number} [expectedShareId]
 * @param {string} [expectedIp]
 * @returns {{ shareId: number, email: string } | null}
 */
function verifyOtpSession(token, expectedShareId, expectedIp) {
  if (!token) return null;
  try {
    const secret = getOtpSecret();
    const decoded = jwt.verify(token, secret);
    if (!decoded || !decoded.shareId || !decoded.email) {
      return null;
    }
    if (expectedShareId !== undefined && decoded.shareId !== expectedShareId) {
      return null;
    }
    if (decoded.ipHash && expectedIp) {
      const currentIpHash = crypto.createHash('sha256').update(String(expectedIp)).digest('hex').slice(0, 16);
      if (decoded.ipHash !== currentIpHash) {
        return null;
      }
    }
    return {
      shareId: decoded.shareId,
      email: decoded.email,
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  signOtpSession,
  verifyOtpSession,
};
