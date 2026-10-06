const db = require('../db');

const COALESCE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const memoryCoalesceMap = new Map();

/**
 * Notifies the owner of a file/share about access attempts.
 * Failed attempts are coalesced: at most one notification per share and reason in any 5-minute window.
 * Successful downloads ('OK') always notify without coalescing.
 *
 * @param {number} ownerId - User ID of file owner
 * @param {number} shareId - Share ID
 * @param {string} kind - 'OK' or failure reason (e.g., 'BAD_PASSWORD', 'REVOKED', 'EXPIRED', 'LIMIT', 'NOT_ON_LIST', 'BAD_OTP', 'OTP_LOCKED')
 * @param {string} message - Notification text message
 * @param {number} [now=Date.now()] - Timestamp
 * @returns {number|null} Notification ID or null if coalesced/skipped
 */
function notify(ownerId, shareId, kind, message, now = Date.now()) {
  if (!ownerId) {
    return null;
  }

  const isSuccess = kind === 'OK' || kind === 'SUCCESS';

  if (!isSuccess) {
    const key = `${shareId}:${kind}`;
    const lastNotified = memoryCoalesceMap.get(key);

    if (lastNotified && now - lastNotified < COALESCE_WINDOW_MS) {
      return null;
    }

    // Check database to ensure persistence across memory state
    if (shareId) {
      try {
        const recentInDb = db
          .prepare(
            `SELECT id FROM notifications
             WHERE user_id = ? AND share_id = ? AND created_at >= ? AND (message LIKE ? OR message LIKE ?)
             LIMIT 1`
          )
          .get(ownerId, shareId, now - COALESCE_WINDOW_MS, `%${kind}%`, `%(${kind})%`);

        if (recentInDb) {
          memoryCoalesceMap.set(key, now);
          return null;
        }
      } catch (err) {
        console.error('[Notifier] Failed checking recent notifications:', err.message);
      }
    }

    memoryCoalesceMap.set(key, now);
  }

  try {
    const result = db
      .prepare(
        `INSERT INTO notifications (user_id, share_id, message, read, created_at)
         VALUES (?, ?, ?, 0, ?)`
      )
      .run(ownerId, shareId || null, message, now);

    return Number(result.lastInsertRowid);
  } catch (err) {
    console.error('[Notifier] Failed to insert notification:', err.message);
    return null;
  }
}

module.exports = {
  notify,
  createNotification: notify,
  notifyOwner: notify,
};
