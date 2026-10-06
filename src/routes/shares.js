const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { generateToken, hashToken } = require('../lib/tokens');
const { getStatus, statusSqlCondition } = require('../lib/status');

const router = express.Router({ mergeParams: true });

const createShareSchema = z
  .object({
    expiresInMinutes: z.coerce.number().int().min(1, 'expiresInMinutes must be at least 1'),
    recipients: z
      .array(z.string().trim().email('Invalid email address'))
      .optional()
      .transform((emails) =>
        emails ? emails.map((e) => e.toLowerCase().trim()).filter(Boolean) : []
      ),
    password: z.string().min(1).max(128).optional().nullable(),
    maxDownloads: z.coerce.number().int().min(1).optional().nullable(),
  })
  .strict();

function getBaseUrl() {
  return process.env.BASE_URL || config.BASE_URL || 'http://localhost:3000';
}

// POST /api/files/:id/shares or /api/shares/files/:id/shares
async function createShareHandler(req, res, next) {
  try {
    const fileId = Number(req.params.id || req.params.fileId);
    if (!fileId || isNaN(fileId)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Verify file exists and belongs to user
    const file = db
      .prepare('SELECT id, owner_id FROM files WHERE id = ? AND deleted_at IS NULL')
      .get(fileId);

    if (!file || file.owner_id !== req.user.id) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { expiresInMinutes, recipients, password, maxDownloads } = req.body;

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const expiresAt = now + expiresInMinutes * 60 * 1000;
    const restricted = recipients && recipients.length > 0 ? 1 : 0;
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;
    const maxDl = maxDownloads && maxDownloads > 0 ? maxDownloads : null;

    let shareId;

    const createTransaction = db.transaction(() => {
      const result = db
        .prepare(
          `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, password_hash, restricted, created_at)
           VALUES (?, ?, ?, NULL, ?, 0, ?, ?, ?)`
        )
        .run(fileId, tokenHash, expiresAt, maxDl, passwordHash, restricted, now);

      shareId = Number(result.lastInsertRowid);

      if (restricted && recipients.length > 0) {
        const insertRecipient = db.prepare(
          'INSERT INTO share_recipients (share_id, email) VALUES (?, ?)'
        );
        for (const email of recipients) {
          insertRecipient.run(shareId, email);
        }
      }
    });

    createTransaction();

    const baseUrl = getBaseUrl().replace(/\/+$/, '');
    const link = `${baseUrl}/s/${rawToken}`;

    return res.status(201).json({
      id: shareId,
      link,
      token: rawToken,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/shares (List own shares with search, filter, and sort in SQL)
router.get('/', requireAuth, (req, res, next) => {
  try {
    const { q, status, from, to, sort, order } = req.query;
    const now = Date.now();

    const conditions = ['f.owner_id = ?', 'f.deleted_at IS NULL'];
    const params = [req.user.id];

    // Text search over file name and recipient emails
    if (q && typeof q === 'string' && q.trim().length > 0) {
      const searchTerm = `%${q.trim()}%`;
      conditions.push(
        '(f.original_name LIKE ? OR EXISTS (SELECT 1 FROM share_recipients sr WHERE sr.share_id = s.id AND sr.email LIKE ?))'
      );
      params.push(searchTerm, searchTerm);
    }

    // Status filter matching statusSqlCondition
    if (status && typeof status === 'string') {
      const upperStatus = status.trim().toUpperCase();
      if (['ACTIVE', 'EXPIRED', 'REVOKED', 'LIMIT_REACHED'].includes(upperStatus)) {
        const cond = statusSqlCondition(upperStatus, now, 's');
        conditions.push(cond.sql);
        params.push(...cond.params);
      }
    }

    // Date range filters (unix ms)
    if (from !== undefined && from !== '') {
      const fromMs = Number(from);
      if (!isNaN(fromMs)) {
        conditions.push('s.created_at >= ?');
        params.push(fromMs);
      }
    }

    if (to !== undefined && to !== '') {
      const toMs = Number(to);
      if (!isNaN(toMs)) {
        conditions.push('s.created_at <= ?');
        params.push(toMs);
      }
    }

    // Sort column and direction whitelist
    const sortColumn =
      sort === 'expiry' || sort === 'expiresAt' ? 's.expires_at' : 's.created_at';
    const sortDirection =
      typeof order === 'string' && order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const sql = `
      SELECT
        s.id,
        s.file_id,
        f.original_name AS fileName,
        s.expires_at,
        s.revoked_at,
        s.max_downloads,
        s.download_count,
        s.restricted,
        s.created_at
      FROM shares s
      JOIN files f ON s.file_id = f.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${sortColumn} ${sortDirection}, s.id DESC
    `;

    const rows = db.prepare(sql).all(...params);

    const recipientStmt = db.prepare(
      'SELECT email FROM share_recipients WHERE share_id = ? ORDER BY id ASC'
    );

    const shares = rows.map((row) => {
      const recipients = recipientStmt.all(row.id).map((r) => r.email);
      const computedStatus = getStatus(
        {
          revoked_at: row.revoked_at,
          expires_at: row.expires_at,
          max_downloads: row.max_downloads,
          download_count: row.download_count,
        },
        now
      );

      return {
        id: row.id,
        fileName: row.fileName,
        status: computedStatus,
        recipients,
        expiresAt: row.expires_at,
        downloadCount: row.download_count,
        maxDownloads: row.max_downloads,
        createdAt: row.created_at,
      };
    });

    return res.status(200).json(shares);
  } catch (err) {
    next(err);
  }
});

// GET /api/shares/:id (Single share detail)
router.get('/:id', requireAuth, (req, res, next) => {
  try {
    const shareId = Number(req.params.id);
    if (!shareId || isNaN(shareId)) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const row = db
      .prepare(
        `SELECT
           s.id,
           s.file_id,
           f.original_name AS fileName,
           f.owner_id,
           s.expires_at,
           s.revoked_at,
           s.max_downloads,
           s.download_count,
           s.password_hash,
           s.restricted,
           s.created_at
         FROM shares s
         JOIN files f ON s.file_id = f.id
         WHERE s.id = ? AND f.deleted_at IS NULL`
      )
      .get(shareId);

    if (!row || row.owner_id !== req.user.id) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const recipients = db
      .prepare('SELECT email FROM share_recipients WHERE share_id = ? ORDER BY id ASC')
      .all(shareId)
      .map((r) => r.email);

    const now = Date.now();
    const status = getStatus(
      {
        revoked_at: row.revoked_at,
        expires_at: row.expires_at,
        max_downloads: row.max_downloads,
        download_count: row.download_count,
      },
      now
    );

    return res.status(200).json({
      id: row.id,
      fileName: row.fileName,
      status,
      recipients,
      expiresAt: row.expires_at,
      downloadCount: row.download_count,
      maxDownloads: row.max_downloads,
      createdAt: row.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/shares/:id/revoke (Revoke a share immediately)
router.post('/:id/revoke', requireAuth, (req, res, next) => {
  try {
    const shareId = Number(req.params.id);
    if (!shareId || isNaN(shareId)) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const share = db
      .prepare(
        `SELECT s.id, f.owner_id
         FROM shares s
         JOIN files f ON s.file_id = f.id
         WHERE s.id = ? AND f.deleted_at IS NULL`
      )
      .get(shareId);

    if (!share || share.owner_id !== req.user.id) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const now = Date.now();
    db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(now, shareId);

    return res.status(200).json({ status: 'REVOKED' });
  } catch (err) {
    next(err);
  }
});

// GET /api/shares/:id/logs (Download logs for a share, newest first)
router.get('/:id/logs', requireAuth, (req, res, next) => {
  try {
    const shareId = Number(req.params.id);
    if (!shareId || isNaN(shareId)) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const share = db
      .prepare(
        `SELECT s.id, f.owner_id
         FROM shares s
         JOIN files f ON s.file_id = f.id
         WHERE s.id = ? AND f.deleted_at IS NULL`
      )
      .get(shareId);

    if (!share || share.owner_id !== req.user.id) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const logs = db
      .prepare(
        `SELECT
           at,
           user_email AS email,
           ip,
           success,
           reason
         FROM download_logs
         WHERE share_id = ?
         ORDER BY at DESC, id DESC`
      )
      .all(shareId);

    return res.status(200).json(logs);
  } catch (err) {
    next(err);
  }
});

// Direct mounting on shares router
router.post('/files/:id/shares', requireAuth, validate(createShareSchema), createShareHandler);

module.exports = router;
module.exports.createShareHandler = createShareHandler;
module.exports.createShareSchema = createShareSchema;
