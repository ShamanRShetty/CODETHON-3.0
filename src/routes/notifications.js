const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications (List notifications for authenticated user, newest first)
router.get('/', requireAuth, (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT
           id,
           share_id,
           share_id AS shareId,
           message,
           read,
           created_at,
           created_at AS createdAt
         FROM notifications
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(req.user.id);

    return res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read (Mark a notification as read, owner only)
router.post('/:id/read', requireAuth, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notification = db
      .prepare('SELECT id, user_id FROM notifications WHERE id = ?')
      .get(id);

    if (!notification || notification.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);

    return res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
