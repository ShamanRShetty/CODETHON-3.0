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
 * @returns {string} JWT token
 */
function signOtpSession({ shareId, email, shareExpiresAt }) {
  const secret = getOtpSecret();
  const normalizedEmail = (email || '').toLowerCase().trim();

  const maxSessionSeconds = 30 * 60; // 30 minutes
  let expirySeconds = maxSessionSeconds;

  if (shareExpiresAt) {
    const msUntilShareExpiry = shareExpiresAt - Date.now();
    const secUntilShareExpiry = Math.floor(msUntilShareExpiry / 1000);
    expirySeconds = Math.max(1, Math.min(maxSessionSeconds, secUntilShareExpiry));
  }

  return jwt.sign(
    {
      shareId,
      email: normalizedEmail,
    },
    secret,
    { expiresIn: expirySeconds }
  );
}

/**
 * Verify an OTP session JWT.
 * Returns decoded payload { shareId, email } if valid and matches expected shareId, else null.
 *
 * @param {string} token
 * @param {number} [expectedShareId]
 * @returns {{ shareId: number, email: string } | null}
 */
function verifyOtpSession(token, expectedShareId) {
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
