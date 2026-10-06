const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');
const { encryptFile } = require('../lib/crypto');
const { hashToken } = require('../lib/tokens');
const config = require('../config');

const storageDir = path.resolve(process.cwd(), 'storage');
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

async function seed() {
  console.log('[Seed] Starting idempotent database seeding...');

  const now = Date.now();
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const sharePasswordHash = await bcrypt.hash('Passcode123!', 10);

  // Use a transaction for atomic, idempotent seeding
  const seedTransaction = db.transaction(() => {
    // 1. Clean existing seed data
    db.prepare('DELETE FROM notifications').run();
    db.prepare('DELETE FROM download_logs').run();
    db.prepare('DELETE FROM share_recipients').run();
    db.prepare('DELETE FROM otp_codes').run();
    db.prepare('DELETE FROM shares').run();
    db.prepare('DELETE FROM files').run();
    db.prepare('DELETE FROM users').run();

    // 2. Insert 2 Users
    const insertUser = db.prepare(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    insertUser.run(1, 'Alice Sender', 'alice@example.com', passwordHash, now - 86400000 * 5);
    insertUser.run(2, 'Bob Recipient', 'bob@example.com', passwordHash, now - 86400000 * 5);

    // 3. Create 6 Real Encrypted Files
    const filesToSeed = [
      {
        id: 1,
        ownerId: 1,
        name: 'Quarterly_Financial_Report.pdf',
        mime: 'application/pdf',
        content: '%PDF-1.4 VaultLink Confidential Q1 Financial Audit Report & Growth Metrics.',
      },
      {
        id: 2,
        ownerId: 1,
        name: 'Offer_Letter_Senior_Architect.pdf',
        mime: 'application/pdf',
        content: '%PDF-1.4 VaultLink Confidential Offer Letter: Senior Security Architect.',
      },
      {
        id: 3,
        ownerId: 1,
        name: 'Passport_Scan_Confidential.png',
        mime: 'image/png',
        content: 'PNG_DUMMY_HEADER_AUTHENTIC_SCAN_DATA_ENCRYPTED_VAULTLINK',
      },
      {
        id: 4,
        ownerId: 1,
        name: 'Board_Meeting_Minutes.txt',
        mime: 'text/plain',
        content: 'Board of Directors Meeting Minutes - Product Launch Roadmap 2026.',
      },
      {
        id: 5,
        ownerId: 2,
        name: 'Project_Architecture_Blueprint.md',
        mime: 'text/markdown',
        content: '# VaultLink Architecture\n\nEnvelope AES-256-GCM encryption & live access checks.',
      },
      {
        id: 6,
        ownerId: 2,
        name: 'Tax_Return_2025.pdf',
        mime: 'application/pdf',
        content: '%PDF-1.4 Federal Tax Filing Return Year 2025 - Confidential.',
      },
    ];

    const insertFile = db.prepare(
      `INSERT INTO files (id, owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const f of filesToSeed) {
      const buffer = Buffer.from(f.content, 'utf8');
      const encrypted = encryptFile(buffer);
      const storedName = `seed_file_${f.id}.bin`;
      const filePath = path.join(storageDir, storedName);

      fs.writeFileSync(filePath, encrypted.ciphertext);

      insertFile.run(
        f.id,
        f.ownerId,
        f.name,
        storedName,
        buffer.length,
        f.mime,
        encrypted.wrappedKey,
        encrypted.iv,
        encrypted.authTag,
        now - 86400000 * (7 - f.id)
      );
    }

    // 4. Seed Shares in all 4 statuses (ACTIVE, EXPIRED, REVOKED, LIMIT_REACHED)
    const sharesToSeed = [
      {
        id: 1,
        fileId: 1,
        token: 'demo_active_share_token_alice_q1_report_12345',
        expiresAt: now + 86400000 * 3, // ACTIVE
        revokedAt: null,
        maxDownloads: 5,
        downloadCount: 1,
        passwordHash: null,
        restricted: 1,
        recipients: ['bob@example.com', 'investor@example.com'],
      },
      {
        id: 2,
        fileId: 2,
        token: 'demo_expired_share_token_alice_offer_letter_0',
        expiresAt: now - 3600000 * 5, // EXPIRED
        revokedAt: null,
        maxDownloads: 1,
        downloadCount: 0,
        passwordHash: null,
        restricted: 1,
        recipients: ['candidate@example.com'],
      },
      {
        id: 3,
        fileId: 3,
        token: 'demo_revoked_share_token_alice_passport_scan_9',
        expiresAt: now + 86400000 * 2,
        revokedAt: now - 3600000 * 2, // REVOKED
        maxDownloads: null,
        downloadCount: 0,
        passwordHash: null,
        restricted: 0,
        recipients: [],
      },
      {
        id: 4,
        fileId: 4,
        token: 'demo_limit_share_token_alice_board_minutes_88',
        expiresAt: now + 86400000 * 4,
        revokedAt: null,
        maxDownloads: 2,
        downloadCount: 2, // LIMIT_REACHED
        passwordHash: sharePasswordHash,
        restricted: 0,
        recipients: [],
      },
      {
        id: 5,
        fileId: 5,
        token: 'demo_active_open_share_token_bob_blueprint_77',
        expiresAt: now + 86400000 * 1, // ACTIVE
        revokedAt: null,
        maxDownloads: null,
        downloadCount: 3,
        passwordHash: null,
        restricted: 0,
        recipients: [],
      },
      {
        id: 6,
        fileId: 6,
        token: 'demo_expired_restricted_token_bob_tax_return_6',
        expiresAt: now - 3600000 * 24, // EXPIRED
        revokedAt: null,
        maxDownloads: 1,
        downloadCount: 1,
        passwordHash: null,
        restricted: 1,
        recipients: ['accountant@example.com'],
      },
    ];

    const insertShare = db.prepare(
      `INSERT INTO shares (id, file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, password_hash, restricted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertRecipient = db.prepare(
      'INSERT INTO share_recipients (share_id, email) VALUES (?, ?)'
    );

    for (const s of sharesToSeed) {
      insertShare.run(
        s.id,
        s.fileId,
        hashToken(s.token),
        s.expiresAt,
        s.revokedAt,
        s.maxDownloads,
        s.downloadCount,
        s.passwordHash,
        s.restricted,
        now - 86400000 * 2
      );

      for (const email of s.recipients) {
        insertRecipient.run(s.id, email.toLowerCase().trim());
      }
    }

    // 5. Seed Download Logs (Success & Failures)
    const insertLog = db.prepare(
      `INSERT INTO download_logs (share_id, user_email, ip, user_agent, success, reason, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    // Share 1 logs
    insertLog.run(1, 'bob@example.com', '192.168.1.15', 'Mozilla/5.0 Chrome/122', 1, 'OK', now - 3600000 * 12);
    insertLog.run(1, 'intruder@external.com', '203.0.113.88', 'curl/8.4.0', 0, 'NOT_ON_LIST', now - 3600000 * 8);

    // Share 2 logs
    insertLog.run(2, null, '198.51.100.12', 'Mozilla/5.0 Safari/17', 0, 'EXPIRED', now - 3600000 * 2);

    // Share 3 logs
    insertLog.run(3, null, '203.0.113.42', 'Mozilla/5.0 Firefox/123', 0, 'REVOKED', now - 3600000 * 1);

    // Share 4 logs
    insertLog.run(4, null, '192.168.1.40', 'Mozilla/5.0 Chrome/122', 1, 'OK', now - 3600000 * 18);
    insertLog.run(4, null, '192.168.1.41', 'Mozilla/5.0 Chrome/122', 1, 'OK', now - 3600000 * 10);
    insertLog.run(4, null, '192.168.1.42', 'Mozilla/5.0 Edge/122', 0, 'BAD_PASSWORD', now - 3600000 * 6);
    insertLog.run(4, null, '192.168.1.43', 'Mozilla/5.0 Chrome/122', 0, 'LIMIT', now - 3600000 * 2);

    // Share 5 logs
    insertLog.run(5, null, '192.168.1.50', 'Mozilla/5.0 Chrome/122', 1, 'OK', now - 3600000 * 5);

    // 6. Seed Notifications
    const insertNotif = db.prepare(
      `INSERT INTO notifications (user_id, share_id, message, read, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    insertNotif.run(1, 1, 'File "Quarterly_Financial_Report.pdf" was downloaded by bob@example.com', 0, now - 3600000 * 12);
    insertNotif.run(1, 1, 'Blocked access attempt (NOT_ON_LIST) from 203.0.113.88', 0, now - 3600000 * 8);
    insertNotif.run(1, 3, 'Blocked access attempt on revoked share from 203.0.113.42', 1, now - 3600000 * 1);
    insertNotif.run(1, 4, 'File "Board_Meeting_Minutes.txt" download limit reached (2/2)', 0, now - 3600000 * 2);
    insertNotif.run(2, 5, 'File "Project_Architecture_Blueprint.md" was downloaded by visitor from 192.168.1.50', 0, now - 3600000 * 5);
  });

  seedTransaction();

  const baseUrl = (config.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  console.log('✅ Database seeded successfully!');
  console.log('\n--- Demo Accounts ---');
  console.log('1. Alice (Sender):    alice@example.com / Password123!');
  console.log('2. Bob (Recipient):   bob@example.com / Password123!');
  console.log('\n--- Demo Share Links ---');
  console.log(`• ACTIVE (Restricted to Bob): ${baseUrl}/s/demo_active_share_token_alice_q1_report_12345`);
  console.log(`• EXPIRED:                    ${baseUrl}/s/demo_expired_share_token_alice_offer_letter_0`);
  console.log(`• REVOKED:                    ${baseUrl}/s/demo_revoked_share_token_alice_passport_scan_9`);
  console.log(`• LIMIT REACHED (Passcode):   ${baseUrl}/s/demo_limit_share_token_alice_board_minutes_88 (Passcode: Passcode123!)`);
  console.log(`• ACTIVE OPEN (Bob):          ${baseUrl}/s/demo_active_open_share_token_bob_blueprint_77`);
}

if (require.main === module) {
  seed()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed Error] Failed to seed database:', err);
      process.exit(1);
    });
}

module.exports = { seed };
