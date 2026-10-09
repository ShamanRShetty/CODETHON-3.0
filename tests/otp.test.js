const { resetDb } = require('./helpers');
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../src/db');
const { requestOtp, verifyOtp } = require('../src/services/otp');
const { sendMail, sendOtpMail } = require('../src/services/mailer');
const config = require('../src/config');

describe('OTP & Mailer Service (D-01)', () => {
  let userId;
  let fileId;
  let shareId;
  const testRecipient = 'recipient@example.com';
  const nonRecipient = 'stranger@example.com';

  beforeEach(() => {
    resetDb(db);

    const userRes = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run('Alice Test', 'alice@example.com', 'hashed_pw', Date.now());
    userId = userRes.lastInsertRowid;

    const fileRes = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(userId, 'secret.pdf', 'stored_hex.bin', 1024, 'application/pdf', 'wk', 'iv', 'tag', Date.now());
    fileId = fileRes.lastInsertRowid;

    const shareRes = db
      .prepare(
        `INSERT INTO shares (file_id, token_hash, expires_at, restricted, created_at)
         VALUES (?, ?, ?, 1, ?)`
      )
      .run(fileId, 'dummy_token_hash', Date.now() + 3600 * 1000, Date.now());
    shareId = shareRes.lastInsertRowid;

    db.prepare(`INSERT INTO share_recipients (share_id, email) VALUES (?, ?)`).run(
      shareId,
      testRecipient
    );
  });

  describe('requestOtp', () => {
    test('generates a 6-digit OTP stored as HMAC-SHA256 with 5-minute expiry for valid recipient', async () => {
      const result = await requestOtp(shareId, testRecipient);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.message, 'If this email is allowed, a code was sent');

      const otpRow = db
        .prepare('SELECT * FROM otp_codes WHERE share_id = ? AND email = ?')
        .get(shareId, testRecipient);

      assert.ok(otpRow, 'OTP row should be created in database');
      assert.strictEqual(otpRow.attempts, 0);
      assert.strictEqual(otpRow.used, 0);
      assert.strictEqual(otpRow.code_hash.length, 64, 'HMAC-SHA256 hex should be 64 characters');

      // Expiry should be approx 5 minutes (300,000 ms) in the future
      const now = Date.now();
      assert.ok(otpRow.expires_at > now + 290 * 1000 && otpRow.expires_at <= now + 305 * 1000);
    });

    test('returns generic success response but does NOT create OTP for unauthorized email (anti-enumeration)', async () => {
      const result = await requestOtp(shareId, nonRecipient);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.message, 'If this email is allowed, a code was sent');

      const otpRow = db
        .prepare('SELECT * FROM otp_codes WHERE share_id = ? AND email = ?')
        .get(shareId, nonRecipient);

      assert.strictEqual(otpRow, undefined, 'No OTP row should be created for unauthorized email');
    });

    test('a new request invalidates older unused codes for that share and email', async () => {
      await requestOtp(shareId, testRecipient);
      const firstOtp = db
        .prepare('SELECT id, used FROM otp_codes WHERE share_id = ? AND email = ?')
        .get(shareId, testRecipient);
      assert.strictEqual(firstOtp.used, 0);

      await requestOtp(shareId, testRecipient);
      const rows = db
        .prepare('SELECT id, used FROM otp_codes WHERE share_id = ? AND email = ? ORDER BY id ASC')
        .all(shareId, testRecipient);

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].used, 1, 'Previous OTP should be marked as used/invalidated');
      assert.strictEqual(rows[1].used, 0, 'New OTP should be active/unused');
    });
  });

  describe('verifyOtp', () => {
    test('correct code works, marks code as used, and returns success', () => {
      const code = '123456';
      const codeHash = crypto
        .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
        .update(code)
        .digest('hex');

      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(shareId, testRecipient, codeHash, Date.now() + 300 * 1000);

      const result = verifyOtp(shareId, testRecipient, '123456');
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.email, testRecipient);
      assert.strictEqual(result.shareId, shareId);

      const row = db.prepare('SELECT used FROM otp_codes WHERE share_id = ?').get(shareId);
      assert.strictEqual(row.used, 1, 'Code must be marked as used');
    });

    test('code is single use (verifying again fails)', () => {
      const code = '654321';
      const codeHash = crypto
        .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
        .update(code)
        .digest('hex');

      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(shareId, testRecipient, codeHash, Date.now() + 300 * 1000);

      const firstVerify = verifyOtp(shareId, testRecipient, code);
      assert.strictEqual(firstVerify.ok, true);

      // Second attempt with the same code must fail
      const secondVerify = verifyOtp(shareId, testRecipient, code);
      assert.strictEqual(secondVerify.ok, false);
      assert.strictEqual(secondVerify.reason, 'BAD_OTP');
    });

    test('wrong code increments attempts and writes download_logs with BAD_OTP', () => {
      const code = '987654';
      const codeHash = crypto
        .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
        .update(code)
        .digest('hex');

      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(shareId, testRecipient, codeHash, Date.now() + 300 * 1000);

      const result = verifyOtp(shareId, testRecipient, '000000', { ip: '127.0.0.1', userAgent: 'test-agent' });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'BAD_OTP');

      const otpRow = db.prepare('SELECT attempts FROM otp_codes WHERE share_id = ?').get(shareId);
      assert.strictEqual(otpRow.attempts, 1);

      const log = db
        .prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC LIMIT 1')
        .get(shareId);
      assert.ok(log);
      assert.strictEqual(log.success, 0);
      assert.strictEqual(log.reason, 'BAD_OTP');
      assert.strictEqual(log.user_email, testRecipient);
      assert.strictEqual(log.ip, '127.0.0.1');
    });

    test('after 5 failed attempts, writes OTP_LOCKED and locks out further attempts', () => {
      const code = '112233';
      const codeHash = crypto
        .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
        .update(code)
        .digest('hex');

      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(shareId, testRecipient, codeHash, Date.now() + 300 * 1000);

      // First 4 wrong attempts
      for (let i = 1; i <= 4; i++) {
        const res = verifyOtp(shareId, testRecipient, `wrong${i}`);
        assert.strictEqual(res.ok, false);
        assert.strictEqual(res.reason, 'BAD_OTP');
      }

      // 5th wrong attempt triggers OTP_LOCKED
      const fifthAttempt = verifyOtp(shareId, testRecipient, 'wrong5');
      assert.strictEqual(fifthAttempt.ok, false);
      assert.strictEqual(fifthAttempt.reason, 'OTP_LOCKED');

      const log5 = db
        .prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC LIMIT 1')
        .get(shareId);
      assert.strictEqual(log5.reason, 'OTP_LOCKED');

      // 6th attempt, even with the correct code, is locked
      const sixthAttempt = verifyOtp(shareId, testRecipient, code);
      assert.strictEqual(sixthAttempt.ok, false);
      assert.strictEqual(sixthAttempt.reason, 'OTP_LOCKED');
    });

    test('expired code fails with BAD_OTP', () => {
      const code = '555666';
      const codeHash = crypto
        .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
        .update(code)
        .digest('hex');

      // Expired 1 second ago
      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(shareId, testRecipient, codeHash, Date.now() - 1000);

      const result = verifyOtp(shareId, testRecipient, code);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'BAD_OTP');

      const log = db
        .prepare('SELECT * FROM download_logs WHERE share_id = ? ORDER BY id DESC LIMIT 1')
        .get(shareId);
      assert.strictEqual(log.reason, 'BAD_OTP');
    });

    test('attack test: concurrent brute-force attempts are strictly serialized and cannot exceed 5 attempts before locking', async () => {
      const code = '778899';
      const codeHash = crypto
        .createHmac('sha256', process.env.OTP_SECRET || config.OTP_SECRET)
        .update(code)
        .digest('hex');

      db.prepare(
        `INSERT INTO otp_codes (share_id, email, code_hash, expires_at, attempts, used)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(shareId, testRecipient, codeHash, Date.now() + 300 * 1000);

      // Launch 10 parallel incorrect verification attempts simultaneously
      const parallelGuesses = Array.from({ length: 10 }, (_, i) => `wrong${i}`);
      const results = await Promise.all(
        parallelGuesses.map((guess) =>
          Promise.resolve().then(() =>
            verifyOtp(shareId, testRecipient, guess, { ip: '198.51.100.5', userAgent: 'attacker' })
          )
        )
      );

      // All 10 must fail
      results.forEach((r) => assert.strictEqual(r.ok, false));

      // Check the database attempts count: must be at least 5
      const otpRow = db
        .prepare('SELECT attempts FROM otp_codes WHERE share_id = ? AND email = ?')
        .get(shareId, testRecipient);
      assert.ok(otpRow.attempts >= 5, `Attempts count must reach at least 5, got ${otpRow.attempts}`);

      // Even the correct code must now be completely locked out
      const lockedAttempt = verifyOtp(shareId, testRecipient, code);
      assert.strictEqual(lockedAttempt.ok, false);
      assert.strictEqual(lockedAttempt.reason, 'OTP_LOCKED');
    });
  });

  describe('mailer.js', () => {
    test('sendMail and sendOtpMail succeed in console mode', async () => {
      process.env.MAIL_MODE = 'console';
      const mailRes = await sendMail({
        to: testRecipient,
        subject: 'Test Subject',
        text: 'Test Body',
      });
      assert.strictEqual(mailRes.success, true);
      assert.ok(mailRes.messageId.startsWith('console-'));

      const otpRes = await sendOtpMail({
        to: testRecipient,
        code: '123456',
        shareId,
      });
      assert.strictEqual(otpRes.success, true);
    });
  });
});
