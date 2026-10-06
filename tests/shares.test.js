const { resetDb } = require('./helpers');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const app = require('../src/server');
const db = require('../src/db');
const { hashToken } = require('../src/lib/tokens');
const { getStatus } = require('../src/lib/status');

describe('Shares API (src/routes/shares.js)', () => {
  let server;
  let baseUrl;
  let user1Cookie;
  let user2Cookie;
  let user1FileId;
  let user2FileId;

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
        name: 'User One',
        email: 'user1.shares@example.com',
        password: 'Password123!',
      }),
    });
    const u1 = await reg1.json();

    const log1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user1.shares@example.com',
        password: 'Password123!',
      }),
    });
    user1Cookie = log1.headers.get('set-cookie').split(';')[0];

    // Register User 2
    const reg2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'User Two',
        email: 'user2.shares@example.com',
        password: 'Password123!',
      }),
    });
    const u2 = await reg2.json();

    const log2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user2.shares@example.com',
        password: 'Password123!',
      }),
    });
    user2Cookie = log2.headers.get('set-cookie').split(';')[0];

    // Upload file for User 1
    const boundary = '----WebKitFormBoundaryShares1';
    const body1 = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="User1_Contract.pdf"',
      'Content-Type: application/pdf',
      '',
      'User 1 confidential contract content',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const up1 = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: user1Cookie,
      },
      body: Buffer.from(body1, 'utf8'),
    });
    const f1 = await up1.json();
    user1FileId = f1.id;

    // Upload file for User 2
    const boundary2 = '----WebKitFormBoundaryShares2';
    const body2 = [
      `--${boundary2}`,
      'Content-Disposition: form-data; name="file"; filename="User2_Invoice.pdf"',
      'Content-Type: application/pdf',
      '',
      'User 2 invoice data',
      `--${boundary2}--`,
      '',
    ].join('\r\n');

    const up2 = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary2}`,
        Cookie: user2Cookie,
      },
      body: Buffer.from(body2, 'utf8'),
    });
    const f2 = await up2.json();
    user2FileId = f2.id;
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('POST /api/files/:id/shares creates share, returns token once, and never stores raw token in DB', async () => {
    const res = await fetch(`${baseUrl}/api/files/${user1FileId}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: user1Cookie,
      },
      body: JSON.stringify({
        expiresInMinutes: 60,
        recipients: ['Client.A@Example.com', 'Client.B@example.com '],
        password: 'SharePassword123!',
        maxDownloads: 3,
      }),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(typeof data.id, 'number');
    assert.strictEqual(typeof data.token, 'string');
    assert.strictEqual(data.token.length, 43); // base64url 32 bytes
    assert.ok(data.link.endsWith(`/s/${data.token}`));

    // Inspect database row
    const row = db.prepare('SELECT * FROM shares WHERE id = ?').get(data.id);
    assert.ok(row);
    assert.strictEqual(row.file_id, user1FileId);

    // Assert raw token is NEVER stored in database, only SHA-256 hash
    assert.strictEqual(row.token_hash, hashToken(data.token));
    assert.notStrictEqual(row.token_hash, data.token);

    // Verify recipients were lowercased and inserted
    const recipients = db
      .prepare('SELECT email FROM share_recipients WHERE share_id = ? ORDER BY email')
      .all(data.id)
      .map((r) => r.email);
    assert.deepStrictEqual(recipients, ['client.a@example.com', 'client.b@example.com']);
    assert.strictEqual(row.restricted, 1);

    // Verify password was hashed with bcrypt
    assert.ok(row.password_hash);
    assert.ok(bcrypt.compareSync('SharePassword123!', row.password_hash));
    assert.strictEqual(row.max_downloads, 3);
  });

  test('POST /api/files/:id/shares returns 404 when attempting to share another user file', async () => {
    const res = await fetch(`${baseUrl}/api/files/${user2FileId}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: user1Cookie, // User 1 trying to share User 2's file
      },
      body: JSON.stringify({
        expiresInMinutes: 30,
      }),
    });

    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, 'File not found');
  });

  test('GET /api/shares returns own shares with computed status and recipients', async () => {
    const res = await fetch(`${baseUrl}/api/shares`, {
      headers: { Cookie: user1Cookie },
    });

    assert.strictEqual(res.status, 200);
    const shares = await res.json();
    assert.ok(Array.isArray(shares));
    assert.ok(shares.length >= 1);

    const firstShare = shares[0];
    assert.strictEqual(firstShare.fileName, 'User1_Contract.pdf');
    assert.strictEqual(firstShare.status, 'ACTIVE');
    assert.ok(Array.isArray(firstShare.recipients));
    assert.strictEqual(firstShare.downloadCount, 0);
  });

  test('GET /api/shares filters by status matching getStatus exactly on seeded data', async () => {
    const now = Date.now();

    // Upload a second file for testing multiple shares
    const boundary = '----WebKitFormBoundarySharesMulti';
    const bodyMulti = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="Multi_Status_Doc.pdf"',
      'Content-Type: application/pdf',
      '',
      'Multi status file content',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const up = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: user1Cookie,
      },
      body: Buffer.from(bodyMulti, 'utf8'),
    });
    const multiFile = await up.json();

    // Seed shares for User 1 in each status
    // 1. ACTIVE
    const sActive = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, 'th_active', ?, NULL, 10, 0, ?)`
      )
      .run(multiFile.id, now + 3600000, now - 5000);

    // 2. EXPIRED
    const sExpired = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, 'th_expired', ?, NULL, 10, 0, ?)`
      )
      .run(multiFile.id, now - 1000, now - 10000);

    // 3. LIMIT_REACHED
    const sLimit = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, 'th_limit', ?, NULL, 2, 2, ?)`
      )
      .run(multiFile.id, now + 3600000, now - 4000);

    // 4. REVOKED
    const sRevoked = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
         VALUES (?, 'th_revoked', ?, ?, 10, 0, ?)`
      )
      .run(multiFile.id, now + 3600000, now - 100, now - 3000);

    // Verify all 4 statuses via GET /api/shares?status=...
    const statuses = ['ACTIVE', 'EXPIRED', 'LIMIT_REACHED', 'REVOKED'];

    for (const st of statuses) {
      const res = await fetch(`${baseUrl}/api/shares?status=${st}`, {
        headers: { Cookie: user1Cookie },
      });
      assert.strictEqual(res.status, 200);
      const items = await res.json();
      assert.ok(Array.isArray(items));
      assert.ok(items.length >= 1);

      for (const item of items) {
        assert.strictEqual(
          item.status,
          st,
          `Item ${item.id} returned by ?status=${st} must have status === ${st}`
        );
      }
    }
  });

  test('GET /api/shares searches by filename and recipient email using q', async () => {
    const now = Date.now();

    // Create a share with distinct filename and recipient
    const shareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, 'th_search_test', ?, NULL, NULL, 0, 1, ?)`
      )
      .run(user1FileId, now + 3600000, now);
    const sId = Number(shareRes.lastInsertRowid);

    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(
      sId,
      'unique_recipient_xyz@example.com'
    );

    // 1. Search by filename substring
    const resFilename = await fetch(`${baseUrl}/api/shares?q=Contract`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resFilename.status, 200);
    const contractItems = await resFilename.json();
    assert.ok(contractItems.length >= 1);
    for (const item of contractItems) {
      assert.match(item.fileName, /Contract/i);
    }

    // 2. Search by recipient email substring
    const resRecipient = await fetch(`${baseUrl}/api/shares?q=unique_recipient_xyz`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resRecipient.status, 200);
    const recipientItems = await resRecipient.json();
    assert.strictEqual(recipientItems.length, 1);
    assert.strictEqual(recipientItems[0].id, sId);
    assert.ok(recipientItems[0].recipients.includes('unique_recipient_xyz@example.com'));

    // 3. Search with non-matching query returns empty array
    const resEmpty = await fetch(`${baseUrl}/api/shares?q=non_existent_query_string_999`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resEmpty.status, 200);
    const emptyItems = await resEmpty.json();
    assert.strictEqual(emptyItems.length, 0);
  });

  test('GET /api/shares filters by date range (from, to) and sorts by created and expiry', async () => {
    const now = Date.now();

    // Date range filter
    const resFrom = await fetch(`${baseUrl}/api/shares?from=${now - 20000}&to=${now + 20000}`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resFrom.status, 200);
    const rangeItems = await resFrom.json();
    assert.ok(rangeItems.length >= 1);
    for (const item of rangeItems) {
      assert.ok(item.createdAt >= now - 20000 && item.createdAt <= now + 20000);
    }

    // Sort by created ASC
    const resCreatedAsc = await fetch(`${baseUrl}/api/shares?sort=created&order=asc`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resCreatedAsc.status, 200);
    const ascItems = await resCreatedAsc.json();
    for (let i = 1; i < ascItems.length; i++) {
      assert.ok(ascItems[i].createdAt >= ascItems[i - 1].createdAt);
    }

    // Sort by expiry DESC
    const resExpiryDesc = await fetch(`${baseUrl}/api/shares?sort=expiry&order=desc`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(resExpiryDesc.status, 200);
    const expDescItems = await resExpiryDesc.json();
    for (let i = 1; i < expDescItems.length; i++) {
      assert.ok(expDescItems[i].expiresAt <= expDescItems[i - 1].expiresAt);
    }
  });

  test('GET /api/shares/:id returns 404 for unowned share', async () => {
    // User 1 gets share 1; User 2 tries to read it
    const listRes = await fetch(`${baseUrl}/api/shares`, {
      headers: { Cookie: user1Cookie },
    });
    const [user1Share] = await listRes.json();

    const res = await fetch(`${baseUrl}/api/shares/${user1Share.id}`, {
      headers: { Cookie: user2Cookie },
    });

    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, 'Share not found');
  });

  test('POST /api/shares/:id/revoke revokes share immediately, and returns 404 for non-owners', async () => {
    // 1. Create a fresh share for User 1
    const createRes = await fetch(`${baseUrl}/api/files/${user1FileId}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: user1Cookie,
      },
      body: JSON.stringify({ expiresInMinutes: 120 }),
    });
    const share = await createRes.json();

    // 2. User 2 tries to revoke User 1's share -> 404
    const unauthorizedRevoke = await fetch(`${baseUrl}/api/shares/${share.id}/revoke`, {
      method: 'POST',
      headers: { Cookie: user2Cookie },
    });
    assert.strictEqual(unauthorizedRevoke.status, 404);

    // 3. User 1 revokes their own share -> 200 { status: 'REVOKED' }
    const validRevoke = await fetch(`${baseUrl}/api/shares/${share.id}/revoke`, {
      method: 'POST',
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(validRevoke.status, 200);
    const revokeData = await validRevoke.json();
    assert.strictEqual(revokeData.status, 'REVOKED');

    // 4. Verify DB has revoked_at set
    const row = db.prepare('SELECT revoked_at FROM shares WHERE id = ?').get(share.id);
    assert.ok(row.revoked_at != null);

    // 5. Verify GET /api/shares returns REVOKED status badge
    const detailRes = await fetch(`${baseUrl}/api/shares/${share.id}`, {
      headers: { Cookie: user1Cookie },
    });
    const detailData = await detailRes.json();
    assert.strictEqual(detailData.status, 'REVOKED');
  });

  test('GET /api/shares/:id/logs returns access logs newest first and returns 404 for non-owners', async () => {
    // 1. Create a share for User 1
    const createRes = await fetch(`${baseUrl}/api/files/${user1FileId}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: user1Cookie,
      },
      body: JSON.stringify({ expiresInMinutes: 10 }),
    });
    const share = await createRes.json();

    // 2. Insert dummy logs for this share
    const now = Date.now();
    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, 'viewer1@example.com', '1.1.1.1', 'Agent1', 1, 'OK', ?)`
    ).run(share.id, now - 2000);

    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, 'viewer2@example.com', '2.2.2.2', 'Agent2', 0, 'BAD_PASSWORD', ?)`
    ).run(share.id, now - 1000);

    // 3. User 2 gets 404
    const unauthLogs = await fetch(`${baseUrl}/api/shares/${share.id}/logs`, {
      headers: { Cookie: user2Cookie },
    });
    assert.strictEqual(unauthLogs.status, 404);

    // 4. User 1 retrieves logs ordered newest first
    const authLogs = await fetch(`${baseUrl}/api/shares/${share.id}/logs`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(authLogs.status, 200);
    const logs = await authLogs.json();
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0].email, 'viewer2@example.com');
    assert.strictEqual(logs[0].reason, 'BAD_PASSWORD');
    assert.strictEqual(logs[0].success, 0);

    assert.strictEqual(logs[1].email, 'viewer1@example.com');
    assert.strictEqual(logs[1].reason, 'OK');
    assert.strictEqual(logs[1].success, 1);
  });
});
