const fs = require('fs');
const path = require('path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { resetDb } = require('./helpers');
const app = require('../src/server');
const db = require('../src/db');
const config = require('../src/config');

describe('End-to-End Workflow (tests/e2e.test.js)', () => {
  let server;
  let baseUrl;
  let userCookie;
  let fileId;
  let share1Token;
  let share1Id;
  let share2Token;
  let share2Id;

  const originalFileContent = 'VaultLink_Top_Secret_Encrypted_Payload_2026_Byte_Exact_Verification';
  const ownerEmail = 'alice.e2e@example.com';
  const ownerPassword = 'Password123!';
  const recipientEmail = 'bob.recipient@example.com';
  const strangerEmail = 'eve.stranger@example.com';

  before(async () => {
    resetDb(db);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  test('Complete End-to-End Lifecycle: Register -> Upload -> Share -> Stranger Blocked -> OTP -> Byte-Exact Download -> Limit Reached -> Revoke', async () => {
    // -------------------------------------------------------------------------
    // 1. Register Owner
    // -------------------------------------------------------------------------
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Owner',
        email: ownerEmail,
        password: ownerPassword,
      }),
    });

    assert.strictEqual(regRes.status, 201, 'Owner registration should return 201');
    const regData = await regRes.json();
    assert.strictEqual(regData.email, ownerEmail);
    assert.strictEqual(typeof regData.id, 'number');

    // Login to capture authentication cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ownerEmail,
        password: ownerPassword,
      }),
    });

    assert.strictEqual(loginRes.status, 200, 'Owner login should return 200');
    const setCookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(setCookieHeader, 'Login response must set authentication cookie');
    userCookie = setCookieHeader.split(';')[0];

    // -------------------------------------------------------------------------
    // 2. Upload File (Encrypted at rest)
    // -------------------------------------------------------------------------
    const boundary = '----WebKitFormBoundaryE2ETestBoundary2026';
    const multipartBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="Confidential_Report.pdf"',
      'Content-Type: application/pdf',
      '',
      originalFileContent,
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const uploadRes = await fetch(`${baseUrl}/api/files`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: userCookie,
      },
      body: Buffer.from(multipartBody, 'utf8'),
    });

    assert.strictEqual(uploadRes.status, 201, 'File upload should return 201');
    const uploadData = await uploadRes.json();
    fileId = uploadData.id;
    assert.strictEqual(uploadData.originalName, 'Confidential_Report.pdf');
    assert.strictEqual(uploadData.size, Buffer.byteLength(originalFileContent));

    // Verify stored file on disk is ciphertext (envelope encryption)
    const fileRow = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    assert.ok(fileRow, 'File row must exist in database');
    const storedPath = path.resolve(process.cwd(), 'storage', fileRow.stored_name);
    const diskBytes = await fs.promises.readFile(storedPath);
    assert.notStrictEqual(
      diskBytes.toString('utf8'),
      originalFileContent,
      'Stored file on disk must be encrypted ciphertext'
    );

    // -------------------------------------------------------------------------
    // 3. Create Restricted Share with One Recipient (maxDownloads = 1)
    // -------------------------------------------------------------------------
    const share1Res = await fetch(`${baseUrl}/api/files/${fileId}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userCookie,
      },
      body: JSON.stringify({
        recipients: [recipientEmail],
        maxDownloads: 1,
        expiresInMinutes: 1440,
      }),
    });

    assert.strictEqual(share1Res.status, 201, 'Share creation should return 201');
    const share1Data = await share1Res.json();
    assert.ok(share1Data.token, 'Raw share token must be returned on creation');
    share1Token = share1Data.token;
    share1Id = share1Data.id;

    // Verify raw token is never stored in DB
    const shareRow = db.prepare('SELECT * FROM shares WHERE id = ?').get(share1Id);
    assert.ok(shareRow, 'Share row must exist in DB');
    assert.notStrictEqual(shareRow.token_hash, share1Token, 'Database must store token hash, not raw token');

    // -------------------------------------------------------------------------
    // 4. Stranger Blocked & Audit Logged
    // -------------------------------------------------------------------------
    // 4a. Stranger attempts direct download without OTP session
    const strangerDownloadRes = await fetch(`${baseUrl}/s/${share1Token}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.strictEqual(strangerDownloadRes.status, 404, 'Stranger download must return generic 404');
    const strangerDownloadData = await strangerDownloadRes.json();
    assert.deepStrictEqual(
      strangerDownloadData,
      { error: 'unavailable' },
      'Public error must be generic unavailable'
    );

    // 4b. Stranger requests OTP for unlisted email
    const strangerOtpRes = await fetch(`${baseUrl}/s/${share1Token}/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: strangerEmail }),
    });

    assert.strictEqual(strangerOtpRes.status, 200, 'OTP request returns generic 200');
    const strangerOtpData = await strangerOtpRes.json();
    assert.deepStrictEqual(strangerOtpData, {
      message: 'If this email is allowed, a code was sent',
    });

    // Verify no OTP code was created for unlisted email
    const strangerOtpRow = db
      .prepare('SELECT * FROM otp_codes WHERE share_id = ? AND email = ?')
      .get(share1Id, strangerEmail);
    assert.strictEqual(strangerOtpRow, undefined, 'No OTP code should be generated for unlisted email');

    // Verify download_logs contains blocked entry
    const strangerLogs = db
      .prepare('SELECT * FROM download_logs WHERE share_id = ? AND success = 0')
      .all(share1Id);
    assert.ok(strangerLogs.length >= 1, 'Blocked access attempts must be recorded in download_logs');

    // -------------------------------------------------------------------------
    // 5. Valid Recipient Requests & Verifies OTP
    // -------------------------------------------------------------------------
    const recipientOtpReqRes = await fetch(`${baseUrl}/s/${share1Token}/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: recipientEmail }),
    });

    assert.strictEqual(recipientOtpReqRes.status, 200);

    // Set known OTP code for deterministic verification
    const testOtpCode = '839201';
    const testOtpHash = crypto
      .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
      .update(testOtpCode)
      .digest('hex');

    db.prepare('UPDATE otp_codes SET code_hash = ? WHERE share_id = ? AND email = ?').run(
      testOtpHash,
      share1Id,
      recipientEmail
    );

    // Verify OTP with valid code
    const verifyOtpRes = await fetch(`${baseUrl}/s/${share1Token}/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: recipientEmail, code: testOtpCode }),
    });

    assert.strictEqual(verifyOtpRes.status, 200, 'Valid OTP verification must return 200');
    const recipientOtpCookieHeader = verifyOtpRes.headers.get('set-cookie');
    assert.ok(recipientOtpCookieHeader, 'Verify response must set vl_otp cookie');
    const recipientOtpCookie = recipientOtpCookieHeader.split(';')[0];

    // -------------------------------------------------------------------------
    // 6. Download Bytes Equal the Original
    // -------------------------------------------------------------------------
    const downloadRes = await fetch(`${baseUrl}/s/${share1Token}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: recipientOtpCookie,
      },
    });

    assert.strictEqual(downloadRes.status, 200, 'Authorized download must return 200');
    assert.match(
      downloadRes.headers.get('content-disposition'),
      /attachment;\s*filename="Confidential_Report\.pdf"/
    );
    assert.strictEqual(downloadRes.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(downloadRes.headers.get('cache-control'), 'no-store');

    const downloadedText = await downloadRes.text();
    assert.strictEqual(
      downloadedText,
      originalFileContent,
      'Decrypted downloaded content must equal original uploaded content byte-for-byte'
    );

    // Verify successful download logged
    const successLogs = db
      .prepare('SELECT * FROM download_logs WHERE share_id = ? AND success = 1')
      .all(share1Id);
    assert.strictEqual(successLogs.length, 1, 'Download log must record success');
    assert.strictEqual(successLogs[0].reason, 'OK');

    // -------------------------------------------------------------------------
    // 7. Second Download Blocked by Limit (maxDownloads = 1)
    // -------------------------------------------------------------------------
    const secondDownloadRes = await fetch(`${baseUrl}/s/${share1Token}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: recipientOtpCookie,
      },
    });

    assert.strictEqual(secondDownloadRes.status, 404, 'Download over limit must return generic 404');
    const secondDownloadData = await secondDownloadRes.json();
    assert.deepStrictEqual(secondDownloadData, { error: 'unavailable' });

    // Verify limit log row exists
    const limitLogs = db
      .prepare('SELECT * FROM download_logs WHERE share_id = ? AND reason = ?')
      .all(share1Id, 'LIMIT');
    assert.ok(limitLogs.length >= 1, 'Limit reached attempt must be logged with reason LIMIT');

    // -------------------------------------------------------------------------
    // 8. Create Another Share, Revoke It, and Confirm Download Fails
    // -------------------------------------------------------------------------
    const share2Res = await fetch(`${baseUrl}/api/files/${fileId}/shares`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userCookie,
      },
      body: JSON.stringify({
        recipients: [recipientEmail],
        maxDownloads: 5,
        expiresInMinutes: 1440,
      }),
    });

    assert.strictEqual(share2Res.status, 201);
    const share2Data = await share2Res.json();
    share2Token = share2Data.token;
    share2Id = share2Data.id;

    // Revoke share 2
    const revokeRes = await fetch(`${baseUrl}/api/shares/${share2Id}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userCookie,
      },
    });

    assert.strictEqual(revokeRes.status, 200, 'Revoke share must return 200');
    const revokeData = await revokeRes.json();
    assert.strictEqual(revokeData.status, 'REVOKED');

    // Attempt download on revoked share
    const revokedDownloadRes = await fetch(`${baseUrl}/s/${share2Token}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    assert.strictEqual(revokedDownloadRes.status, 404, 'Revoked share download must return generic 404');
    const revokedDownloadData = await revokedDownloadRes.json();
    assert.deepStrictEqual(revokedDownloadData, { error: 'unavailable' });

    // Verify REVOKED log row in download_logs
    const revokeLogs = db
      .prepare('SELECT * FROM download_logs WHERE share_id = ? AND reason = ?')
      .all(share2Id, 'REVOKED');
    assert.ok(revokeLogs.length >= 1, 'Revoked download attempt must be logged with reason REVOKED');
  });
});
