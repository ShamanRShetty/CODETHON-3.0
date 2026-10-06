const cron = require('node-cron');
const db = require('../db');

/**
 * Deletes expired OTP records from the database.
 * Does not alter or flip status on shares or files.
 *
 * @param {number} [now=Date.now()]
 * @returns {{ deleted: number }}
 */
function cleanupExpiredOtps(now = Date.now()) {
  try {
    const result = db.prepare('DELETE FROM otp_codes WHERE expires_at < ?').run(now);
    return { deleted: result.changes };
  } catch (err) {
    console.error('[Cleanup] Failed to clean up expired OTPs:', err.message);
    return { deleted: 0 };
  }
}

/**
 * Starts a background scheduled cron job to clean up expired OTPs.
 * Optional support job; correctness of the application never depends on it.
 *
 * @param {string} [cronExpression='0 * * * *'] - Defaults to once every hour
 * @returns {cron.ScheduledTask}
 */
function startCleanupJob(cronExpression = '0 * * * *') {
  return cron.schedule(cronExpression, () => {
    cleanupExpiredOtps();
  });
}

module.exports = {
  cleanupExpiredOtps,
  startCleanupJob,
  cleanupExpired: cleanupExpiredOtps,
};
