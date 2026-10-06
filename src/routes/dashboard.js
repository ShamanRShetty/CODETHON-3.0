const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { statusSqlCondition } = require('../lib/status');

const router = express.Router();

// GET /api/dashboard (Dashboard statistics and recent activity for authenticated user)
router.get('/', requireAuth, (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = Date.now();

    // 1. Total storage bytes used by user's active files
    const storageRow = db
      .prepare(
        `SELECT COALESCE(SUM(size), 0) AS storageBytes
         FROM files
         WHERE owner_id = ? AND deleted_at IS NULL`
      )
      .get(userId);
    const storageBytes = storageRow ? storageRow.storageBytes : 0;

    // 2. Total active file count
    const fileRow = db
      .prepare(
        `SELECT COUNT(*) AS fileCount
         FROM files
         WHERE owner_id = ? AND deleted_at IS NULL`
      )
      .get(userId);
    const fileCount = fileRow ? fileRow.fileCount : 0;

    // 3. Shares categorized by computed status using statusSqlCondition helper
    const statuses = ['ACTIVE', 'EXPIRED', 'REVOKED', 'LIMIT_REACHED'];
    const sharesByStatus = {
      ACTIVE: 0,
      EXPIRED: 0,
      REVOKED: 0,
      LIMIT_REACHED: 0,
    };

    for (const status of statuses) {
      const cond = statusSqlCondition(status, now, 's');
      const countRow = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM shares s
           JOIN files f ON s.file_id = f.id
           WHERE f.owner_id = ? AND f.deleted_at IS NULL AND ${cond.sql}`
        )
        .get(userId, ...cond.params);

      sharesByStatus[status] = countRow ? countRow.count : 0;
    }

    // 4. Recent activity (access logs across all shares owned by user)
    const recentActivity = db
      .prepare(
        `SELECT
           dl.id,
           dl.share_id AS shareId,
           f.original_name AS fileName,
           dl.user_email AS userEmail,
           dl.ip,
           dl.success,
           dl.reason,
           dl.at
         FROM download_logs dl
         JOIN shares s ON dl.share_id = s.id
         JOIN files f ON s.file_id = f.id
         WHERE f.owner_id = ? AND f.deleted_at IS NULL
         ORDER BY dl.at DESC, dl.id DESC
         LIMIT 10`
      )
      .all(userId);

    return res.status(200).json({
      storageBytes,
      fileCount,
      sharesByStatus,
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
