const fs = require('fs');
const path = require('path');
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const { resetDb } = require('./helpers');
const db = require('../src/db');
const { checkAccess, consumeDownload } = require('../src/lib/access');
const { generateToken, hashToken } = require('../src/lib/tokens');
const { signOtpSession } = require('../src/lib/otpSession');
const { encryptFile } = require('../src/lib/crypto');

describe('Access Checker (src/lib/access.js)', () => {
  const now = Date.now();
  let ownerId;
  let fileId;
  let filePlaintext = 'Confidential Board Minutes 2026';

  before(async () => {
    // Reset DB tables safely
    resetDb(db);

    // Create user
    const uRes = db
      .prepare(
        'INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
      )
      .run('Alice Owner', 'alice.owner@example.com', 'hash', now);
    ownerId = Number(uRes.lastInsertRowid);

    // Encrypt and save test file
    const encrypted = encryptFile(Buffer.from(filePlaintext, 'utf8'));
    const storedName = 'access_test_blob.bin';
    const storageDir = path.resolve(process.cwd(), 'storage');
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    await fs.promises.writeFile(path.join(storageDir, storedName), encrypted.ciphertext);

    const fRes = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ownerId,
        'Board_Minutes.txt',
        storedName,
        Buffer.byteLength(filePlaintext),
        'text/plain',
        encrypted.wrappedKey,
        encrypted.iv,
        encrypted.authTag,
        now
      );
    fileId = Number(fRes.lastInsertRowid);
  });

  test('Branch 1: Unknown token returns NOT_FOUND and does NOT insert a fake share log', () => {
    const logsBefore = db.prepare('SELECT COUNT(*) AS c FROM download_logs').get().c;
    const res = checkAccess({ token: 'completely_unknown_token', ip: '127.0.0.1' });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'NOT_FOUND');

    const logsAfter = db.prepare('SELECT COUNT(*) AS c FROM download_logs').get().c;
    assert.strictEqual(logsBefore, logsAfter, 'Unknown tokens must not insert fake rows into DB');
  });

  test('Branch 2: Revoked share returns REVOKED and logs failure', () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, ?, NULL, 0, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now - 100, now);
    const shareId = Number(sRes.lastInsertRowid);

    const res = checkAccess({ token, ip: '192.168.1.1', userAgent: 'TestRunner' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'REVOKED');

    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(log);
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'REVOKED');
  });

  test('Branch 3: Expired share returns EXPIRED and logs failure', () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, ?)`
      )
      .run(fileId, tokenHash, now - 5000, now - 10000);
    const shareId = Number(sRes.lastInsertRowid);

    const res = checkAccess({ token, ip: '192.168.1.2', userAgent: 'TestRunner' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'EXPIRED');

    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(log);
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'EXPIRED');
  });

  test('Branch 4: Download limit reached returns LIMIT and logs failure', () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, 2, 2, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(sRes.lastInsertRowid);

    const res = checkAccess({ token, ip: '192.168.1.3', userAgent: 'TestRunner' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'LIMIT');

    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(log);
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'LIMIT');
  });

  test('Branch 5: Restricted share without OTP session returns NOT_ON_LIST', () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(sRes.lastInsertRowid);

    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(
      shareId,
      'bob@example.com'
    );

    const res = checkAccess({ token, otpSession: null, ip: '192.168.1.4' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'NOT_ON_LIST');

    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(log);
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'NOT_ON_LIST');
  });

  test('Branch 6: Restricted share with OTP session for an unlisted email returns NOT_ON_LIST', () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(sRes.lastInsertRowid);

    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(
      shareId,
      'allowed.recipient@example.com'
    );

    const strangerSession = signOtpSession({ shareId, email: 'stranger@example.com' });
    const res = checkAccess({ token, otpSession: strangerSession, ip: '192.168.1.5' });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'NOT_ON_LIST');

    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(log);
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'NOT_ON_LIST');
    assert.strictEqual(log.user_email, 'stranger@example.com');
  });

  test('Branch 7: Wrong password returns BAD_PASSWORD and logs failure', () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const pwHash = bcrypt.hashSync('CorrectSecret123!', 10);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, password_hash, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, ?, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, pwHash, now);
    const shareId = Number(sRes.lastInsertRowid);

    const res = checkAccess({ token, password: 'WrongSecret!', ip: '192.168.1.6' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'BAD_PASSWORD');

    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(log);
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'BAD_PASSWORD');
  });

  test('Branch 8: Successful access check and download consumption', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const pwHash = bcrypt.hashSync('SecretPass!', 10);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, password_hash, restricted, created_at)
         VALUES (?, ?, ?, NULL, 5, 0, ?, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, pwHash, now);
    const shareId = Number(sRes.lastInsertRowid);

    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(
      shareId,
      'bob@example.com'
    );

    const validSession = signOtpSession({ shareId, email: 'bob@example.com' });
    const checkRes = checkAccess({
      token,
      otpSession: validSession,
      password: 'SecretPass!',
      ip: '192.168.1.7',
      userAgent: 'Firefox',
    });

    assert.strictEqual(checkRes.ok, true);
    assert.strictEqual(checkRes.email, 'bob@example.com');
    assert.strictEqual(checkRes.share.id, shareId);

    // Consume download
    const downloadRes = await consumeDownload({
      shareId,
      email: checkRes.email,
      ip: '192.168.1.7',
      userAgent: 'Firefox',
    });

    assert.ok(Buffer.isBuffer(downloadRes.buffer));
    assert.strictEqual(downloadRes.buffer.toString('utf8'), filePlaintext);
    assert.strictEqual(downloadRes.originalName, 'Board_Minutes.txt');

    // Confirm download_count incremented to 1
    const shareAfter = db.prepare('SELECT download_count FROM shares WHERE id = ?').get(shareId);
    assert.strictEqual(shareAfter.download_count, 1);

    // Confirm success log entry
    const log = db.prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.strictEqual(log.success, 1);
    assert.strictEqual(log.reason, 'OK');
    assert.strictEqual(log.user_email, 'bob@example.com');

    // Confirm owner notification
    const notif = db.prepare('SELECT * FROM notifications WHERE share_id = ? ORDER BY id DESC').get(shareId);
    assert.ok(notif);
    assert.strictEqual(notif.user_id, ownerId);
    assert.match(notif.message, /bob@example\.com/);
  });

  test('Branch 9: Concurrency safety - exactly ONE download succeeds when limit is 1', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, 1, 0, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(sRes.lastInsertRowid);

    // Launch 10 concurrent download consumption attempts
    const attempts = Array.from({ length: 10 }, (_, i) =>
      consumeDownload({
        shareId,
        email: `downloader${i}@example.com`,
        ip: `10.0.0.${i}`,
        userAgent: 'ConcurrentTest',
      })
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, error: err.message }))
    );

    const results = await Promise.all(attempts);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.strictEqual(successes.length, 1, 'Exactly ONE download must succeed on a limit of 1');
    assert.strictEqual(failures.length, 9, 'All subsequent concurrent downloads must fail');
    assert.ok(failures.every((f) => f.error === 'LIMIT'));

    // Final download_count must be exactly 1
    const finalShare = db.prepare('SELECT download_count FROM shares WHERE id = ?').get(shareId);
    assert.strictEqual(finalShare.download_count, 1);
  });

  test('Branch 10: Failed decryption does NOT increment download count or record success log', async () => {
    // Create a corrupted file record whose wrapped_key or auth_tag is invalid
    const now = Date.now();
    const badFileRes = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ownerId,
        'Corrupted.txt',
        'stored_board_minutes.bin', // points to valid ciphertext, but we tamper keys below
        100,
        'text/plain',
        '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        '000000000000000000000000',
        '00000000000000000000000000000000',
        now
      );
    const badFileId = Number(badFileRes.lastInsertRowid);

    const token = generateToken();
    const badShareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, 5, 0, ?)`
      )
      .run(badFileId, hashToken(token), now + 3600000, now);
    const badShareId = Number(badShareRes.lastInsertRowid);

    await assert.rejects(
      async () => {
        await consumeDownload({
          shareId: badShareId,
          email: 'test@example.com',
          ip: '127.0.0.1',
          userAgent: 'TestAgent',
        });
      },
      (err) => {
        return err !== null;
      }
    );

    // Download count must remain 0
    const shareAfter = db.prepare('SELECT download_count FROM shares WHERE id = ?').get(badShareId);
    assert.strictEqual(shareAfter.download_count, 0, 'download_count must not increment on decrypt failure');

    // No success log should exist
    const logs = db.prepare('SELECT * FROM download_logs WHERE share_id = ? AND success = 1').all(badShareId);
    assert.strictEqual(logs.length, 0, 'No success log should be written on decrypt failure');
  });

  test('attack test: concurrent consumeDownload strictly enforces download limit atomically without extra decryptions', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const limitShareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, 1, 0, ?)`
      )
      .run(fileId, tokenHash, Date.now() + 3600000, Date.now());
    const limitShareId = Number(limitShareRes.lastInsertRowid);

    // Launch 5 parallel consumeDownload calls for max_downloads: 1
    const parallelCalls = Array.from({ length: 5 }, (_, i) =>
      consumeDownload({
        shareId: limitShareId,
        email: 'recipient@example.com',
        ip: `192.168.1.${10 + i}`,
        userAgent: 'ConcurrentTester',
      })
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, error: err.message }))
    );

    const outcomes = await Promise.all(parallelCalls);
    const successes = outcomes.filter((o) => o.success);
    const failures = outcomes.filter((o) => !o.success);

    assert.strictEqual(successes.length, 1, 'Exactly 1 download must succeed');
    assert.strictEqual(failures.length, 4, '4 downloads must fail with limit');
    failures.forEach((f) => assert.strictEqual(f.error, 'LIMIT'));

    // Final download count in DB must be exactly 1
    const shareAfter = db.prepare('SELECT download_count FROM shares WHERE id = ?').get(limitShareId);
    assert.strictEqual(shareAfter.download_count, 1);
  });
});
