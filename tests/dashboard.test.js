const { resetDb } = require('./helpers');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/server');
const db = require('../src/db');
const { cleanupExpiredOtps } = require('../src/services/cleanup');
const { hashToken } = require('../src/lib/tokens');

describe('Dashboard API & Cleanup Service (B-05)', () => {
  let server;
  let baseUrl;
  let user1Cookie;
  let user2Cookie;
  let user1Id;
  let user2Id;
  let user1File1Id;
  let user1File2Id;

  before(async () => {
    resetDb(db);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    const now = Date.now();

    // Register User 1
    const reg1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dashboard Alice',
        email: 'alice.dash@example.com',
        password: 'Password123!',
      }),
    });
    const u1 = await reg1.json();
    user1Id = u1.id;

    const log1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice.dash@example.com',
        password: 'Password123!',
      }),
    });
    user1Cookie = log1.headers.get('set-cookie').split(';')[0];

    // Register User 2
    const reg2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dashboard Bob',
        email: 'bob.dash@example.com',
        password: 'Password123!',
      }),
    });
    const u2 = await reg2.json();
    user2Id = u2.id;

    const log2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bob.dash@example.com',
        password: 'Password123!',
      }),
    });
    user2Cookie = log2.headers.get('set-cookie').split(';')[0];

    // Insert 2 files for User 1 (sizes: 1000 and 2500 -> total 3500 bytes)
    const f1 = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, 'Doc1.pdf', 'stored_doc1.bin', 1000, 'application/pdf', 'wk1', 'iv1', 'tag1', ?)`
      )
      .run(user1Id, now);
    user1File1Id = Number(f1.lastInsertRowid);

    const f2 = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, 'Doc2.xlsx', 'stored_doc2.bin', 2500, 'application/vnd.ms-excel', 'wk2', 'iv2', 'tag2', ?)`
      )
      .run(user1Id, now);
    user1File2Id = Number(f2.lastInsertRowid);

    // Insert 1 file for User 2 (size: 8000)
    db.prepare(
      `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
       VALUES (?, 'Bob_Doc.pdf', 'stored_bob.bin', 8000, 'application/pdf', 'wkb', 'ivb', 'tagb', ?)`
    ).run(user2Id, now);

    // Seed User 1 shares in each status:
    // 1. ACTIVE share
    const sActive = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, ?, ?, NULL, 10, 0, ?)`
      )
      .run(user1File1Id, hashToken('dash_token_active'), now + 3600000, now - 5000);
    const activeShareId = Number(sActive.lastInsertRowid);

    // 2. EXPIRED share
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, NULL, 10, 0, ?)`
    ).run(user1File1Id, hashToken('dash_token_expired'), now - 1000, now - 10000);

    // 3. LIMIT_REACHED share
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, NULL, 2, 2, ?)`
    ).run(user1File2Id, hashToken('dash_token_limit'), now + 3600000, now - 4000);

    // 4. REVOKED share
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, ?, 10, 0, ?)`
    ).run(user1File2Id, hashToken('dash_token_revoked'), now + 3600000, now - 100, now - 3000);

    // Insert access activity logs for User 1's active share
    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, 'viewer1@example.com', '192.168.1.1', 'Agent1', 1, 'OK', ?)`
    ).run(activeShareId, now - 2000);

    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, 'intruder@example.com', '10.0.0.1', 'Agent2', 0, 'BAD_PASSWORD', ?)`
    ).run(activeShareId, now - 1000);
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('GET /api/dashboard requires authentication', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`);
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/dashboard returns correct storage, counts, status breakdown, and recent activity', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Cookie: user1Cookie },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    // Storage and file counts for User 1
    assert.strictEqual(data.storageBytes, 3500); // 1000 + 2500
    assert.strictEqual(data.fileCount, 2);

    // Status breakdown matching statusSqlCondition
    assert.deepStrictEqual(data.sharesByStatus, {
      ACTIVE: 1,
      EXPIRED: 1,
      LIMIT_REACHED: 1,
      REVOKED: 1,
    });

    // Recent activity list
    assert.ok(Array.isArray(data.recentActivity));
    assert.strictEqual(data.recentActivity.length, 2);
    assert.strictEqual(data.recentActivity[0].reason, 'BAD_PASSWORD'); // newest first
    assert.strictEqual(data.recentActivity[0].success, 0);
    assert.strictEqual(data.recentActivity[0].fileName, 'Doc1.pdf');
    assert.strictEqual(data.recentActivity[1].reason, 'OK');
    assert.strictEqual(data.recentActivity[1].success, 1);
  });

  test('GET /api/dashboard isolates data between users', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Cookie: user2Cookie },
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.storageBytes, 8000);
    assert.strictEqual(data.fileCount, 1);
    assert.deepStrictEqual(data.sharesByStatus, {
      ACTIVE: 0,
      EXPIRED: 0,
      LIMIT_REACHED: 0,
      REVOKED: 0,
    });
    assert.deepStrictEqual(data.recentActivity, []);
  });

  describe('cleanup.js service', () => {
    test('cleanupExpiredOtps deletes expired OTP rows and leaves unexpired rows intact without altering shares', () => {
      const now = Date.now();

      // Insert 1 expired OTP and 1 unexpired OTP
      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (1, 'old@example.com', 'hash_old', ?, 0, 0)`
      ).run(now - 10000);

      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (1, 'active@example.com', 'hash_act', ?, 0, 0)`
      ).run(now + 300000);

      // Run cleanup
      const result = cleanupExpiredOtps(now);
      assert.strictEqual(result.deleted, 1);

      // Check remaining OTP row
      const remainingOtps = db.prepare('SELECT email FROM otp_codes').all();
      assert.strictEqual(remainingOtps.length, 1);
      assert.strictEqual(remainingOtps[0].email, 'active@example.com');

      // Verify shares are completely untouched
      const shareCount = db.prepare('SELECT COUNT(*) as count FROM shares').get().count;
      assert.strictEqual(shareCount, 4);
    });
  });
});
