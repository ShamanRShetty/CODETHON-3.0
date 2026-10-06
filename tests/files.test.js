const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { resetDb } = require('./helpers');
const app = require('../src/server');
const db = require('../src/db');
const { decryptFile } = require('../src/lib/crypto');

describe('Files API (src/routes/files.js)', () => {
  let server;
  let baseUrl;
  let user1Cookie;
  let user2Cookie;
  let user1Id;
  let user2Id;

  before(async () => {
    // Reset DB tables safely
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
        email: 'user1@example.com',
        password: 'Password123!',
      }),
    });
    const data1 = await reg1.json();
    user1Id = data1.id;

    const log1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user1@example.com',
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
        email: 'user2@example.com',
        password: 'Password123!',
      }),
    });
    const data2 = await reg2.json();
    user2Id = data2.id;

    const log2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user2@example.com',
        password: 'Password123!',
      }),
    });
    user2Cookie = log2.headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('POST /api/files uploads and encrypts a file, storing ciphertext on disk', async () => {
    const fileContent = 'Top secret document contents with sensitive data!';
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="Confidential_Report.txt"',
      'Content-Type: text/plain',
      '',
      fileContent,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const res = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: user1Cookie,
      },
      body: Buffer.from(body, 'utf8'),
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(typeof data.id, 'number');
    assert.strictEqual(data.originalName, 'Confidential_Report.txt');
    assert.strictEqual(data.size, Buffer.byteLength(fileContent));
    assert.strictEqual(typeof data.uploadedAt, 'number');

    // Verify row in DB
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(data.id);
    assert.ok(row);
    assert.strictEqual(row.owner_id, user1Id);
    assert.strictEqual(row.original_name, 'Confidential_Report.txt');
    assert.match(row.stored_name, /^[0-9a-f]{32}\.bin$/);

    // Verify file on disk in storage/ is ciphertext and NOT equal to plaintext
    const diskPath = path.resolve(process.cwd(), 'storage', row.stored_name);
    assert.ok(fs.existsSync(diskPath), 'Encrypted blob file must exist on disk');

    const diskBlob = fs.readFileSync(diskPath);
    assert.notDeepStrictEqual(diskBlob, Buffer.from(fileContent));
    assert.strictEqual(diskBlob.includes(fileContent), false);

    // Verify decryptFile recovers original plaintext
    const decrypted = decryptFile({
      ciphertext: diskBlob,
      wrappedKey: row.wrapped_key,
      iv: row.iv,
      authTag: row.auth_tag,
    });
    assert.strictEqual(decrypted.toString('utf8'), fileContent);
  });

  test('POST /api/files rejects missing file with 400', async () => {
    const boundary = '----WebKitFormBoundaryEmpty';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="other"',
      '',
      'value',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const res = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: user1Cookie,
      },
      body: Buffer.from(body, 'utf8'),
    });

    assert.strictEqual(res.status, 400);
  });

  test('GET /api/files lists only files belonging to the authenticated user with shareCount', async () => {
    // User 1 uploads another file
    const boundary = '----WebKitFormBoundaryList';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="Second_File.pdf"',
      'Content-Type: application/pdf',
      '',
      'PDF dummy binary content',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploadRes = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: user1Cookie,
      },
      body: Buffer.from(body, 'utf8'),
    });
    const newFile = await uploadRes.json();

    // Create an active share for this new file
    const now = Date.now();
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, 'dummy_hash_share_count', ?, NULL, 5, 0, ?)`
    ).run(newFile.id, now + 3600000, now);

    // GET /api/files as User 1
    const res1 = await fetch(`${baseUrl}/api/files`, {
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(res1.status, 200);
    const files1 = await res1.json();
    assert.ok(Array.isArray(files1));
    assert.ok(files1.length >= 2);

    const targetFile = files1.find((f) => f.id === newFile.id);
    assert.ok(targetFile);
    assert.strictEqual(targetFile.originalName, 'Second_File.pdf');
    assert.strictEqual(targetFile.shareCount, 1);

    // GET /api/files as User 2 (should be empty for User 2)
    const res2 = await fetch(`${baseUrl}/api/files`, {
      headers: { Cookie: user2Cookie },
    });
    assert.strictEqual(res2.status, 200);
    const files2 = await res2.json();
    assert.deepStrictEqual(files2, []);
  });

  test('DELETE /api/files/:id returns 404 for unowned file', async () => {
    // User 1 owns file 1; User 2 tries to delete it
    const res = await fetch(`${baseUrl}/api/files/1`, {
      method: 'DELETE',
      headers: { Cookie: user2Cookie },
    });

    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.error, 'File not found');
  });

  test('DELETE /api/files/:id soft-deletes file and revokes active shares in one transaction', async () => {
    // Upload a file as User 1
    const boundary = '----WebKitFormBoundaryDelete';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="To_Be_Deleted.txt"',
      'Content-Type: text/plain',
      '',
      'Ephemeral content',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploadRes = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: user1Cookie,
      },
      body: Buffer.from(body, 'utf8'),
    });
    const file = await uploadRes.json();

    // Create 2 active shares for this file
    const now = Date.now();
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, 'share_del_1', ?, NULL, 5, 0, ?)`
    ).run(file.id, now + 3600000, now);

    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, 'share_del_2', ?, NULL, 5, 0, ?)`
    ).run(file.id, now + 3600000, now);

    // Verify shares are active (revoked_at IS NULL)
    const activeSharesBefore = db
      .prepare('SELECT COUNT(*) AS c FROM shares WHERE file_id = ? AND revoked_at IS NULL')
      .get(file.id).c;
    assert.strictEqual(activeSharesBefore, 2);

    // Delete the file
    const delRes = await fetch(`${baseUrl}/api/files/${file.id}`, {
      method: 'DELETE',
      headers: { Cookie: user1Cookie },
    });
    assert.strictEqual(delRes.status, 200);

    // Check DB: file.deleted_at is set
    const fileRow = db.prepare('SELECT deleted_at FROM files WHERE id = ?').get(file.id);
    assert.ok(fileRow.deleted_at != null);

    // Check DB: both shares are now revoked (revoked_at != null)
    const activeSharesAfter = db
      .prepare('SELECT COUNT(*) AS c FROM shares WHERE file_id = ? AND revoked_at IS NULL')
      .get(file.id).c;
    assert.strictEqual(activeSharesAfter, 0);

    // Check GET /api/files: soft-deleted file is no longer returned
    const listRes = await fetch(`${baseUrl}/api/files`, {
      headers: { Cookie: user1Cookie },
    });
    const list = await listRes.json();
    assert.strictEqual(list.some((f) => f.id === file.id), false);
  });
});
