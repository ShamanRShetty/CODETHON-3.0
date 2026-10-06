const { resetDb } = require('./helpers');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/server');
const db = require('../src/db');
const { notify } = require('../src/services/notifier');
const { generateToken, hashToken } = require('../src/lib/tokens');
const { encryptFile } = require('../src/lib/crypto');
const fs = require('fs');
const path = require('path');

describe('Notifications API & Service (B-03, D-02)', () => {
  let server;
  let baseUrl;
  let user1Cookie;
  let user2Cookie;
  let user1Id;
  let user2Id;
  let user1FileId;
  let user1ShareId;
  let user1ShareToken;
  const fileContent = 'Secret notification test dataset';

  before(async () => {
    resetDb(db);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Register User 1
    const reg1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Notifier Owner',
        email: 'owner.notify@example.com',
        password: 'Password123!',
      }),
    });
    const u1 = await reg1.json();
    user1Id = u1.id;

    const log1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner.notify@example.com',
        password: 'Password123!',
      }),
    });
    user1Cookie = log1.headers.get('set-cookie').split(';')[0];

    // Register User 2
    const reg2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Stranger User',
        email: 'stranger.notify@example.com',
        password: 'Password123!',
      }),
    });
    const u2 = await reg2.json();
    user2Id = u2.id;

    const log2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'stranger.notify@example.com',
        password: 'Password123!',
      }),
    });
    user2Cookie = log2.headers.get('set-cookie').split(';')[0];

    // Setup encrypted file and share for user 1
    const now = Date.now();
    const encrypted = encryptFile(Buffer.from(fileContent, 'utf8'));
    const storedName = 'notify_test_file.bin';
    const storageDir = path.resolve(process.cwd(), 'storage');
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    await fs.promises.writeFile(path.join(storageDir, storedName), encrypted.ciphertext);

    const fRes = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user1Id,
        'Notify_Report.pdf',
        storedName,
        Buffer.byteLength(fileContent),
        'application/pdf',
        encrypted.wrappedKey,
        encrypted.iv,
        encrypted.authTag,
        now
      );
    user1FileId = Number(fRes.lastInsertRowid);

    user1ShareToken = generateToken();
    const tokenHash = hashToken(user1ShareToken);
    const sRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, 50, 0, ?)`
      )
      .run(user1FileId, tokenHash, now + 3600000, now);
    user1ShareId = Number(sRes.lastInsertRowid);
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('20 failures in a row give 1 notification and 20 download_logs rows (coalescing)', async () => {
    // Clear existing logs & notifications
    db.prepare('DELETE FROM notifications').run();
    db.prepare('DELETE FROM download_logs').run();

    // Revoke share to induce REVOKED failures
    db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(Date.now() - 1000, user1ShareId);

    // Perform 20 blocked access attempts via public download endpoint
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`${baseUrl}/s/${user1ShareToken}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 404);
    }

    // Assert download_logs has all 20 attempts logged
    const logs = db.prepare('SELECT id, reason FROM download_logs WHERE share_id = ?').all(user1ShareId);
    assert.strictEqual(logs.length, 20, 'All 20 failed attempts must be logged in download_logs');
    for (const log of logs) {
      assert.strictEqual(log.reason, 'REVOKED');
    }

    // Assert notifications has exactly 1 coalesced row for this owner
    const notifications = db
      .prepare('SELECT id, message FROM notifications WHERE user_id = ?')
      .all(user1Id);
    assert.strictEqual(notifications.length, 1, '20 failures within 5 min must produce exactly 1 notification');
    assert.match(notifications[0].message, /revoked/i);
  });

  test('success always notifies without coalescing', async () => {
    // Un-revoke share
    db.prepare('UPDATE shares SET revoked_at = NULL WHERE id = ?').run(user1ShareId);
    db.prepare('DELETE FROM notifications').run();

    // Perform 3 successful downloads
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/s/${user1ShareToken}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 200);
    }

    const notifications = db
      .prepare('SELECT id, message FROM notifications WHERE user_id = ?')
      .all(user1Id);
    assert.strictEqual(notifications.length, 3, 'Successful downloads must never be coalesced');
    for (const n of notifications) {
      assert.match(n.message, /downloaded/i);
    }
  });

  test('different failure reasons create separate notifications', () => {
    db.prepare('DELETE FROM notifications').run();
    const now = Date.now();

    // 1. First BAD_PASSWORD failure
    const id1 = notify(user1Id, user1ShareId, 'BAD_PASSWORD', 'Blocked: bad password', now);
    assert.ok(id1);

    // 2. Second BAD_PASSWORD failure (should coalesce / return null)
    const id2 = notify(user1Id, user1ShareId, 'BAD_PASSWORD', 'Blocked: bad password', now + 1000);
    assert.strictEqual(id2, null);

    // 3. Different reason EXPIRED (should NOT coalesce with BAD_PASSWORD)
    const id3 = notify(user1Id, user1ShareId, 'EXPIRED', 'Blocked: share expired', now + 2000);
    assert.ok(id3);

    const total = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ?').get(user1Id);
    assert.strictEqual(total.count, 2);
  });

  test('GET /api/notifications returns user notifications newest first', async () => {
    db.prepare('DELETE FROM notifications').run();
    const now = Date.now();

    db.prepare(
      `INSERT INTO notifications (user_id, share_id, message, read, created_at)
       VALUES (?, ?, 'Old Notification', 0, ?)`
    ).run(user1Id, user1ShareId, now - 5000);

    db.prepare(
      `INSERT INTO notifications (user_id, share_id, message, read, created_at)
       VALUES (?, ?, 'New Notification', 0, ?)`
    ).run(user1Id, user1ShareId, now - 1000);

    // User 1 gets own notifications
    const res1 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(res1.status, 200);
    const items1 = await res1.json();
    assert.strictEqual(items1.length, 2);
    assert.strictEqual(items1[0].message, 'New Notification');
    assert.strictEqual(items1[1].message, 'Old Notification');

    // User 2 gets empty list
    const res2 = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Cookie: user2Cookie },
    });
    assert.strictEqual(res2.status, 200);
    const items2 = await res2.json();
    assert.strictEqual(items2.length, 0);
  });

  test('POST /api/notifications/:id/read marks notification as read and enforces owner check', async () => {
    db.prepare('DELETE FROM notifications').run();
    const now = Date.now();

    const insertRes = db
      .prepare(
        `INSERT INTO notifications (user_id, share_id, message, read, created_at)
         VALUES (?, ?, 'Unread Alert', 0, ?)`
      )
      .run(user1Id, user1ShareId, now);
    const notifId = Number(insertRes.lastInsertRowid);

    // 1. User 2 tries to mark User 1's notification as read -> 404
    const resUnauthorized = await fetch(`${baseUrl}/api/notifications/${notifId}/read`, {
      method: 'POST',
      headers: { Cookie: user2Cookie },
    });
    assert.strictEqual(resUnauthorized.status, 404);

    // Verify still unread (read === 0)
    const rowBefore = db.prepare('SELECT read FROM notifications WHERE id = ?').get(notifId);
    assert.strictEqual(rowBefore.read, 0);

    // 2. User 1 marks own notification as read -> 204
    const resAuthorized = await fetch(`${baseUrl}/api/notifications/${notifId}/read`, {
      method: 'POST',
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resAuthorized.status, 204);

    // Verify marked as read (read === 1)
    const rowAfter = db.prepare('SELECT read FROM notifications WHERE id = ?').get(notifId);
    assert.strictEqual(rowAfter.read, 1);
  });
});
