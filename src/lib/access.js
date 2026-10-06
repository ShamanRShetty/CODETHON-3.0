const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { hashToken } = require('./tokens');
const { verifyOtpSession } = require('./otpSession');
const { decryptFile } = require('./crypto');
const { notify } = require('../services/notifier');

const storageDir = path.resolve(process.cwd(), 'storage');

function logFailure(shareId, ownerId, email, ip, userAgent, reason, message) {
  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    ).run(shareId, email || null, ip || null, userAgent || null, reason, now);

    if (ownerId && shareId) {
      notify(ownerId, shareId, reason, message || `Blocked access attempt (${reason})`, now);
    }
  } catch (err) {
    console.error('[AccessChecker] Failed to log failure:', err.message);
  }
}

/**
 * Validates access to a share following the strict order defined in Rule 02 and ARCHITECTURE section 6:
 * 1. Token found
 * 2. Revoked
 * 3. Expired
 * 4. Download limit
 * 5. Recipient / OTP
 * 6. Password
 *
 * @param {Object} params
 * @param {string} params.token - Raw share token
 * @param {string} [params.otpSession] - OTP session JWT token
 * @param {string} [params.password] - Share password
 * @param {string} [params.ip] - Client IP
 * @param {string} [params.userAgent] - Client user agent
 * @returns {{ ok: boolean, reason?: string, share?: Object, email?: string }}
 */
function checkAccess({ token, otpSession, password, ip, userAgent }) {
  if (!token) {
    console.warn(`[AccessChecker] Missing token from IP: ${ip || 'unknown'}`);
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const tokenHash = hashToken(token);
  const now = Date.now();

  const share = db
    .prepare(
      `SELECT
         s.id,
         s.file_id,
         s.token_hash,
         s.expires_at,
         s.revoked_at,
         s.max_downloads,
         s.download_count,
         s.password_hash,
         s.restricted,
         s.created_at,
         f.owner_id,
         f.original_name,
         f.stored_name,
         f.size,
         f.mime,
         f.wrapped_key,
         f.iv,
         f.auth_tag
       FROM shares s
       JOIN files f ON s.file_id = f.id
       WHERE s.token_hash = ? AND f.deleted_at IS NULL`
    )
    .get(tokenHash);

  // 1. Token found
  if (!share) {
    console.warn(`[AccessChecker] Unknown token access attempt from IP: ${ip || 'unknown'}`);
    return { ok: false, reason: 'NOT_FOUND' };
  }

  // 2. Revoked
  if (share.revoked_at != null) {
    logFailure(share.id, share.owner_id, null, ip, userAgent, 'REVOKED', `Blocked access: share was revoked`);
    return { ok: false, reason: 'REVOKED', share };
  }

  // 3. Expired
  if (now > share.expires_at) {
    logFailure(share.id, share.owner_id, null, ip, userAgent, 'EXPIRED', `Blocked access: share has expired`);
    return { ok: false, reason: 'EXPIRED', share };
  }

  // 4. Download limit
  if (share.max_downloads != null && share.download_count >= share.max_downloads) {
    logFailure(share.id, share.owner_id, null, ip, userAgent, 'LIMIT', `Blocked access: download limit reached`);
    return { ok: false, reason: 'LIMIT', share };
  }

  let verifiedEmail = null;

  // 5. Restricted share recipient / OTP check
  if (share.restricted) {
    const session = verifyOtpSession(otpSession, share.id);
    if (!session || !session.email) {
      logFailure(
        share.id,
        share.owner_id,
        null,
        ip,
        userAgent,
        'NOT_ON_LIST',
        `Blocked access: OTP verification required`
      );
      return { ok: false, reason: 'NOT_ON_LIST', share };
    }

    const normalizedEmail = session.email.toLowerCase().trim();
    const recipient = db
      .prepare('SELECT id FROM share_recipients WHERE share_id = ? AND email = ?')
      .get(share.id, normalizedEmail);

    if (!recipient) {
      logFailure(
        share.id,
        share.owner_id,
        normalizedEmail,
        ip,
        userAgent,
        'NOT_ON_LIST',
        `Blocked access: ${normalizedEmail} is not on the recipient list`
      );
      return { ok: false, reason: 'NOT_ON_LIST', share };
    }

    verifiedEmail = normalizedEmail;
  }

  // 6. Password check
  if (share.password_hash) {
    if (!password || !bcrypt.compareSync(password, share.password_hash)) {
      logFailure(
        share.id,
        share.owner_id,
        verifiedEmail,
        ip,
        userAgent,
        'BAD_PASSWORD',
        `Blocked access: incorrect share password`
      );
      return { ok: false, reason: 'BAD_PASSWORD', share };
    }
  }

  // 7. All checks pass
  return {
    ok: true,
    share,
    email: verifiedEmail,
  };
}

/**
 * Consumes a download inside ONE atomic SQLite transaction and streams decrypted buffer.
 *
 * @param {Object} params
 * @param {number} params.shareId
 * @param {string} [params.email]
 * @param {string} [params.ip]
 * @param {string} [params.userAgent]
 * @returns {Promise<{ buffer: Buffer, originalName: string, mime: string, size: number }>}
 */
async function consumeDownload({ shareId, email, ip, userAgent }) {
  let shareData;

  const tx = db.transaction(() => {
    const now = Date.now();
    const share = db
      .prepare(
        `SELECT
           s.id,
           s.file_id,
           s.expires_at,
           s.revoked_at,
           s.max_downloads,
           s.download_count,
           f.owner_id,
           f.original_name,
           f.stored_name,
           f.size,
           f.mime,
           f.wrapped_key,
           f.iv,
           f.auth_tag
         FROM shares s
         JOIN files f ON s.file_id = f.id
         WHERE s.id = ? AND f.deleted_at IS NULL`
      )
      .get(shareId);

    if (!share) {
      throw new Error('NOT_FOUND');
    }

    if (share.revoked_at != null) {
      throw new Error('REVOKED');
    }

    if (now > share.expires_at) {
      throw new Error('EXPIRED');
    }

    if (share.max_downloads != null && share.download_count >= share.max_downloads) {
      throw new Error('LIMIT');
    }

    // Increment download count
    db.prepare('UPDATE shares SET download_count = download_count + 1 WHERE id = ?').run(shareId);

    // Insert success log
    db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, ?, ?, ?, 1, 'OK', ?)`
    ).run(shareId, email || null, ip || null, userAgent || null, now);

    // Insert owner notification
    const recipientInfo = email ? email : ip ? `visitor from ${ip}` : 'visitor';
    notify(
      share.owner_id,
      shareId,
      'OK',
      `File "${share.original_name}" was downloaded by ${recipientInfo}`,
      now
    );

    shareData = share;
  });

  tx();

  // Decrypt file only after transaction succeeds
  const storedPath = path.join(storageDir, shareData.stored_name);
  const ciphertext = await fs.promises.readFile(storedPath);

  // If decryption fails, decryptFile throws and zero partial data is returned
  const buffer = decryptFile({
    ciphertext,
    wrappedKey: shareData.wrapped_key,
    iv: shareData.iv,
    authTag: shareData.auth_tag,
  });

  return {
    buffer,
    originalName: shareData.original_name,
    mime: shareData.mime || 'application/octet-stream',
    size: shareData.size,
  };
}

module.exports = {
  checkAccess,
  consumeDownload,
};
