const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encryptFile } = require('../lib/crypto');

const router = express.Router();

const storageDir = path.resolve(process.cwd(), 'storage');
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const maxUploadBytes = (config.MAX_UPLOAD_MB || 25) * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadBytes,
  },
});

// Wrap multer upload middleware to catch size limits and missing files cleanly
function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File size exceeds the maximum limit of ${config.MAX_UPLOAD_MB || 25} MB`,
        });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}

// POST /api/files (auth required, multipart field 'file')
router.post('/', requireAuth, handleUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalName = req.file.originalname || 'unnamed.bin';
    const size = req.file.size;
    const mime = req.file.mimetype || 'application/octet-stream';

    // Envelope encrypt file buffer
    const encrypted = encryptFile(req.file.buffer);

    // Generate safe storage filename: random hex + .bin
    const storedName = `${crypto.randomBytes(16).toString('hex')}.bin`;
    const storedPath = path.join(storageDir, storedName);

    // Write ciphertext to storage
    await fs.promises.writeFile(storedPath, encrypted.ciphertext);

    const now = Date.now();

    const result = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        originalName,
        storedName,
        size,
        mime,
        encrypted.wrappedKey,
        encrypted.iv,
        encrypted.authTag,
        now
      );

    const fileId = Number(result.lastInsertRowid);

    return res.status(201).json({
      id: fileId,
      originalName,
      size,
      uploadedAt: now,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/files (auth required, list own files with shareCount)
router.get('/', requireAuth, (req, res, next) => {
  try {
    const now = Date.now();
    const files = db
      .prepare(
        `SELECT
           f.id,
           f.original_name AS originalName,
           f.size,
           f.mime,
           f.uploaded_at AS uploadedAt,
           (
             SELECT COUNT(*)
             FROM shares s
             WHERE s.file_id = f.id
               AND s.revoked_at IS NULL
               AND s.expires_at > ?
           ) AS shareCount
         FROM files f
         WHERE f.owner_id = ? AND f.deleted_at IS NULL
         ORDER BY f.uploaded_at DESC`
      )
      .all(now, req.user.id);

    return res.status(200).json(files);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/files/:id (auth required, soft delete and revoke shares in one transaction)
router.delete('/:id', requireAuth, (req, res, next) => {
  try {
    const fileId = Number(req.params.id);
    if (!fileId || isNaN(fileId)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = db
      .prepare('SELECT id, owner_id FROM files WHERE id = ? AND deleted_at IS NULL')
      .get(fileId);

    // Return 404 (not 403) for files the user does not own or files that are deleted
    if (!file || file.owner_id !== req.user.id) {
      return res.status(404).json({ error: 'File not found' });
    }

    const now = Date.now();

    const deleteTransaction = db.transaction(() => {
      db.prepare('UPDATE files SET deleted_at = ? WHERE id = ?').run(now, fileId);
      db.prepare(
        'UPDATE shares SET revoked_at = ? WHERE file_id = ? AND revoked_at IS NULL'
      ).run(now, fileId);
    });

    deleteTransaction();

    return res.status(200).json({ message: 'File deleted and active shares revoked' });
  } catch (err) {
    next(err);
  }
});

// POST /api/files/:id/shares
const { createShareHandler, createShareSchema } = require('./shares');
const { validate } = require('../middleware/validate');
router.post('/:id/shares', requireAuth, validate(createShareSchema), createShareHandler);

module.exports = router;
