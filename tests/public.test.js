const { resetDb } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const app = require('../src/server');
const db = require('../src/db');
const { generateToken, hashToken } = require('../src/lib/tokens');
const { encryptFile } = require('../src/lib/crypto');
const { signOtpSession } = require('../src/lib/otpSession');
const config = require('../src/config');
const crypto = require('crypto');

const storageDir = path.resolve(process.cwd(), 'storage');

describe('Public Download API (src/routes/public.js)', () => {
  let server;
  let baseUrl;
  let ownerId;
  let fileId;
  const fileContent = 'Highly classified research dataset - 2026';

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
    const uRes = db
      .prepare(
        'INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)'
      )
      .run('File Owner', 'owner@example.com', 'hash', now);
    ownerId = Number(uRes.lastInsertRowid);

    const encrypted = encryptFile(Buffer.from(fileContent, 'utf8'));
    const storedName = 'public_test_file.bin';
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
        'Research_Data.csv',
        storedName,
        Buffer.byteLength(fileContent),
        'text/csv',
        encrypted.wrappedKey,
        encrypted.iv,
        encrypted.authTag,
        now
      );
    fileId = Number(fRes.lastInsertRowid);
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('GET /s/:token serves s.html with security headers for any token', async () => {
    // 1. Existing token
    const res1 = await fetch(`${baseUrl}/s/valid_sample_token`);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(res1.headers.get('cache-control'), 'no-store');
    const html1 = await res1.text();
    assert.match(html1, /Secure File Download/);

    // 2. Non-existent token (must return the exact same page and not reveal existence)
    const res2 = await fetch(`${baseUrl}/s/completely_fake_token_12345`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('referrer-policy'), 'no-referrer');
    assert.strictEqual(res2.headers.get('cache-control'), 'no-store');
    const html2 = await res2.text();
    assert.strictEqual(html1, html2);
  });

  test('POST /s/:token/otp/request returns identical 200 message for listed, unlisted, and non-existent tokens', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();

    const shareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(shareRes.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(
      shareId,
      'listed@example.com'
    );

    const expected = { message: 'If this email is allowed, a code was sent' };

    // Case 1: Listed recipient email
    const resListed = await fetch(`${baseUrl}/s/${token}/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'listed@example.com' }),
    });
    assert.strictEqual(resListed.status, 200);
    assert.deepStrictEqual(await resListed.json(), expected);

    // Case 2: Unlisted recipient email
    const resUnlisted = await fetch(`${baseUrl}/s/${token}/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unlisted@example.com' }),
    });
    assert.strictEqual(resUnlisted.status, 200);
    assert.deepStrictEqual(await resUnlisted.json(), expected);

    // Case 3: Completely fake share token
    const resFakeToken = await fetch(`${baseUrl}/s/nonexistent_share_token/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'listed@example.com' }),
    });
    assert.strictEqual(resFakeToken.status, 200);
    assert.deepStrictEqual(await resFakeToken.json(), expected);
  });

  test('POST /s/:token/otp/verify sets httpOnly cookie on success and allows download for restricted share', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const email = 'recipient_user@example.com';

    const shareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(shareRes.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(shareId, email);

    // 1. Request OTP
    const reqRes = await fetch(`${baseUrl}/s/${token}/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.strictEqual(reqRes.status, 200);

    // Find the generated OTP in db and compute the known code for testing
    // Or set a deterministic test OTP in db
    const testCode = '654321';
    const testCodeHash = crypto
      .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
      .update(testCode)
      .digest('hex');
    db.prepare('UPDATE otp_codes SET code_hash = ? WHERE share_id = ? AND email = ?').run(
      testCodeHash,
      shareId,
      email
    );

    // 2. Verify OTP
    const verifyRes = await fetch(`${baseUrl}/s/${token}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: testCode }),
    });
    assert.strictEqual(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.deepStrictEqual(verifyData, { ok: true, message: 'Verified' });

    // Assert Set-Cookie header contains otp_<shareId>
    const setCookie = verifyRes.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.ok(setCookie.includes(`otp_${shareId}=`));
    assert.ok(setCookie.includes('HttpOnly'));

    // Extract cookie value
    const cookieVal = setCookie.split(';')[0];

    // 3. Download using the OTP session cookie
    const downloadRes = await fetch(`${baseUrl}/s/${token}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieVal,
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(downloadRes.status, 200);
    const buffer = await downloadRes.arrayBuffer();
    assert.strictEqual(Buffer.from(buffer).toString('utf8'), fileContent);
  });

  test('POST /s/:token/otp/verify returns generic 400 on incorrect or expired code', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const email = 'verify_fail@example.com';

    const shareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(shareRes.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(shareId, email);

    // 1. Wrong code
    const resWrong = await fetch(`${baseUrl}/s/${token}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '000000' }),
    });
    assert.strictEqual(resWrong.status, 400);
    assert.deepStrictEqual(await resWrong.json(), { error: 'Invalid or expired verification code' });

    // 2. Non-existent token
    const resBadToken = await fetch(`${baseUrl}/s/non_existent_token_123/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456' }),
    });
    assert.strictEqual(resBadToken.status, 400);
    assert.deepStrictEqual(await resBadToken.json(), { error: 'Invalid or expired verification code' });
  });

  test('POST /s/:token/download successfully downloads file with 4 mandatory headers', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();

    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, NULL, 5, 0, ?)`
    ).run(fileId, tokenHash, now + 3600000, now);

    const res = await fetch(`${baseUrl}/s/${token}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 200);

    // Assert 4 mandatory headers per ARCHITECTURE.md
    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition);
    assert.match(disposition, /attachment;\s*filename="Research_Data\.csv"/);
    assert.strictEqual(res.headers.get('content-type'), 'application/octet-stream');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');

    const buffer = await res.arrayBuffer();
    assert.strictEqual(Buffer.from(buffer).toString('utf8'), fileContent);
  });

  test('POST /s/:token/download with password requires correct password', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const pwHash = bcrypt.hashSync('VaultPass123!', 10);

    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, password_hash, created_at)
       VALUES (?, ?, ?, NULL, 5, 0, ?, ?)`
    ).run(fileId, tokenHash, now + 3600000, pwHash, now);

    // 1. Wrong password returns generic 404
    const wrongRes = await fetch(`${baseUrl}/s/${token}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'IncorrectPassword' }),
    });
    assert.strictEqual(wrongRes.status, 404);
    assert.deepStrictEqual(await wrongRes.json(), { error: 'unavailable' });

    // 2. Correct password succeeds
    const correctRes = await fetch(`${baseUrl}/s/${token}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'VaultPass123!' }),
    });
    assert.strictEqual(correctRes.status, 200);
    const buffer = await correctRes.arrayBuffer();
    assert.strictEqual(Buffer.from(buffer).toString('utf8'), fileContent);
  });

  test('POST /s/:token/download returns identical generic 404 for EVERY failure reason', async () => {
    const now = Date.now();
    const expectedError = { error: 'unavailable' };

    // Failure 1: Unknown token
    const resUnknown = await fetch(`${baseUrl}/s/unknown_token_xyz/download`, {
      method: 'POST',
    });
    assert.strictEqual(resUnknown.status, 404);
    assert.deepStrictEqual(await resUnknown.json(), expectedError);

    // Failure 2: Revoked share
    const tRevoked = generateToken();
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?)`
    ).run(fileId, hashToken(tRevoked), now + 3600000, now - 100, now);
    const resRevoked = await fetch(`${baseUrl}/s/${tRevoked}/download`, { method: 'POST' });
    assert.strictEqual(resRevoked.status, 404);
    assert.deepStrictEqual(await resRevoked.json(), expectedError);

    // Failure 3: Expired share
    const tExpired = generateToken();
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, NULL, NULL, 0, ?)`
    ).run(fileId, hashToken(tExpired), now - 5000, now - 10000);
    const resExpired = await fetch(`${baseUrl}/s/${tExpired}/download`, { method: 'POST' });
    assert.strictEqual(resExpired.status, 404);
    assert.deepStrictEqual(await resExpired.json(), expectedError);

    // Failure 4: Download limit reached
    const tLimit = generateToken();
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, NULL, 1, 1, ?)`
    ).run(fileId, hashToken(tLimit), now + 3600000, now);
    const resLimit = await fetch(`${baseUrl}/s/${tLimit}/download`, { method: 'POST' });
    assert.strictEqual(resLimit.status, 404);
    assert.deepStrictEqual(await resLimit.json(), expectedError);

    // Failure 5: Restricted without OTP cookie
    const tRestricted = generateToken();
    const rRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, hashToken(tRestricted), now + 3600000, now);
    const rShareId = Number(rRes.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(
      rShareId,
      'allowed@example.com'
    );

    const resNoOtp = await fetch(`${baseUrl}/s/${tRestricted}/download`, { method: 'POST' });
    assert.strictEqual(resNoOtp.status, 404);
    assert.deepStrictEqual(await resNoOtp.json(), expectedError);

    // Failure 6: Restricted with OTP cookie for unauthorized email
    const wrongOtpSession = signOtpSession({ shareId: rShareId, email: 'unauthorized@example.com' });
    const resWrongOtp = await fetch(`${baseUrl}/s/${tRestricted}/download`, {
      method: 'POST',
      headers: {
        Cookie: `otp_${rShareId}=${wrongOtpSession}`,
      },
    });
    assert.strictEqual(resWrongOtp.status, 404);
    assert.deepStrictEqual(await resWrongOtp.json(), expectedError);
  });

  test('POST /s/:token/otp/request logs NOT_ON_LIST in download_logs for stranger email (PRD D-02)', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const allowedEmail = 'allowed_member@example.com';
    const strangerEmail = 'stranger_attacker@example.com';

    const shareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, tokenHash, now + 3600000, now);
    const shareId = Number(shareRes.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(shareId, allowedEmail);

    const res = await fetch(`${baseUrl}/s/${token}/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: strangerEmail }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.message, 'If this email is allowed, a code was sent');

    // Verify audit log has stranger attempt recorded
    const log = db
      .prepare('SELECT * FROM download_logs WHERE share_id = ? AND user_email = ?')
      .get(shareId, strangerEmail);

    assert.ok(log, 'Stranger OTP request must be logged in download_logs');
    assert.strictEqual(log.success, 0);
    assert.strictEqual(log.reason, 'NOT_ON_LIST');
  });

  test('POST /s/:token/download correctly resolves share-specific cookie when recipient verified multiple shares', async () => {
    const now = Date.now();
    const email = 'multishare@example.com';

    // Share 1
    const token1 = generateToken();
    const s1Res = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, hashToken(token1), now + 3600000, now);
    const share1Id = Number(s1Res.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(share1Id, email);

    // Share 2
    const token2 = generateToken();
    const s2Res = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, restricted, created_at)
         VALUES (?, ?, ?, NULL, NULL, 0, 1, ?)`
      )
      .run(fileId, hashToken(token2), now + 3600000, now);
    const share2Id = Number(s2Res.lastInsertRowid);
    db.prepare('INSERT INTO share_recipients (share_id, email) VALUES (?, ?)').run(share2Id, email);

    const cookie1 = signOtpSession({ shareId: share1Id, email });
    const cookie2 = signOtpSession({ shareId: share2Id, email });

    // Client sends both cookies
    const multiCookieHeader = `otp_${share1Id}=${cookie1}; otp_${share2Id}=${cookie2}`;

    // Download share 2
    const res2 = await fetch(`${baseUrl}/s/${token2}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: multiCookieHeader,
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res2.status, 200, 'Download share 2 must succeed with multi-share cookies present');
  });

  test('POST /s/:token/download supports non-Latin UTF-8 filenames (Kannada, Hindi, Emoji)', async () => {
    const fs = require('fs');
    const { encryptFile } = require('../src/lib/crypto');

    const utf8Filename = 'ಕನ್ನಡ_दस्तावेज़_🔒_report.pdf';
    const content = Buffer.from('UTF-8 test content');
    const encrypted = encryptFile(content);
    const storedName = 'utf8_test_file.bin';
    fs.writeFileSync(path.join(storageDir, storedName), encrypted.ciphertext);

    const now = Date.now();
    const fRes = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ownerId,
        utf8Filename,
        storedName,
        content.length,
        'application/pdf',
        encrypted.wrappedKey,
        encrypted.iv,
        encrypted.authTag,
        now
      );
    const utf8FileId = Number(fRes.lastInsertRowid);

    const token = generateToken();
    db.prepare(
      `INSERT INTO shares (file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, created_at)
       VALUES (?, ?, ?, NULL, NULL, 0, ?)`
    ).run(utf8FileId, hashToken(token), now + 3600000, now);

    const res = await fetch(`${baseUrl}/s/${token}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(res.status, 200);
    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition, 'Must have Content-Disposition header');
    assert.ok(disposition.includes("filename*=UTF-8''"), 'Must include RFC 5987 UTF-8 encoded filename');
    const buffer = await res.arrayBuffer();
    assert.strictEqual(Buffer.from(buffer).toString('utf8'), 'UTF-8 test content');
  });
});

