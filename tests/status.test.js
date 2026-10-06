const { test, describe } = require('node:test');
const assert = require('node:assert');
const { getStatus, statusSqlCondition } = require('../src/lib/status');
const { createTestDb } = require('./helpers');

describe('Status Module (src/lib/status.js)', () => {
  const now = 1700000000000;

  test('computes ACTIVE status for unexpired, unrevoked share with remaining downloads', () => {
    const share = {
      expires_at: now + 60000,
      revoked_at: null,
      max_downloads: 5,
      download_count: 2,
    };
    assert.strictEqual(getStatus(share, now), 'ACTIVE');
  });

  test('computes ACTIVE status for unlimited downloads', () => {
    const share = {
      expires_at: now + 60000,
      revoked_at: null,
      max_downloads: null,
      download_count: 50,
    };
    assert.strictEqual(getStatus(share, now), 'ACTIVE');
  });

  test('computes EXPIRED status when now > expires_at', () => {
    const share = {
      expires_at: now - 1000,
      revoked_at: null,
      max_downloads: 5,
      download_count: 0,
    };
    assert.strictEqual(getStatus(share, now), 'EXPIRED');
  });

  test('computes LIMIT_REACHED status when download_count >= max_downloads', () => {
    const share = {
      expires_at: now + 60000,
      revoked_at: null,
      max_downloads: 3,
      download_count: 3,
    };
    assert.strictEqual(getStatus(share, now), 'LIMIT_REACHED');
  });

  test('computes REVOKED status when revoked_at is not null', () => {
    const share = {
      expires_at: now + 60000,
      revoked_at: now - 500,
      max_downloads: 5,
      download_count: 1,
    };
    assert.strictEqual(getStatus(share, now), 'REVOKED');
  });

  test('priority: REVOKED beats EXPIRED and LIMIT_REACHED', () => {
    const share = {
      expires_at: now - 10000, // expired
      revoked_at: now - 5000, // revoked
      max_downloads: 1,
      download_count: 2, // limit reached
    };
    assert.strictEqual(getStatus(share, now), 'REVOKED');
  });

  test('priority: EXPIRED beats LIMIT_REACHED', () => {
    const share = {
      expires_at: now - 1000, // expired
      revoked_at: null,
      max_downloads: 1,
      download_count: 2, // limit reached
    };
    assert.strictEqual(getStatus(share, now), 'EXPIRED');
  });

  test('statusSqlCondition mirrors getStatus exactly on SQLite rows', () => {
    const db = createTestDb();

    // Create a user and a file first to satisfy foreign keys
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, created_at)
       VALUES (1, 'Test User', 'test@example.com', 'hash', ?)`
    ).run(now);

    db.prepare(
      `INSERT INTO files (id, owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
       VALUES (1, 1, 'doc.pdf', 'stored.bin', 1024, 'application/pdf', 'key', 'iv', 'tag', ?)`
    ).run(now);

    const testShares = [
      { id: 1, expires_at: now + 60000, revoked_at: null, max_downloads: 5, download_count: 0 }, // ACTIVE
      { id: 2, expires_at: now - 10000, revoked_at: null, max_downloads: 5, download_count: 0 }, // EXPIRED
      { id: 3, expires_at: now + 60000, revoked_at: null, max_downloads: 2, download_count: 2 }, // LIMIT_REACHED
      { id: 4, expires_at: now + 60000, revoked_at: now - 100, max_downloads: 5, download_count: 0 }, // REVOKED
      { id: 5, expires_at: now - 10000, revoked_at: now - 100, max_downloads: 1, download_count: 1 }, // REVOKED (beats expired/limit)
      { id: 6, expires_at: now - 10000, revoked_at: null, max_downloads: 1, download_count: 1 }, // EXPIRED (beats limit)
    ];

    const insertStmt = db.prepare(
      `INSERT INTO shares (id, file_id, token_hash, expires_at, revoked_at, max_downloads, download_count, password_hash, restricted, created_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, NULL, 0, ?)`
    );

    for (const s of testShares) {
      insertStmt.run(s.id, `token_hash_${s.id}`, s.expires_at, s.revoked_at, s.max_downloads, s.download_count, now);
    }

    const statuses = ['ACTIVE', 'EXPIRED', 'LIMIT_REACHED', 'REVOKED'];

    for (const status of statuses) {
      const condition = statusSqlCondition(status, now);
      const rows = db
        .prepare(`SELECT id, expires_at, revoked_at, max_downloads, download_count FROM shares WHERE ${condition.sql}`)
        .all(...condition.params);

      // Verify that every row returned by SQL produces the same status via getStatus
      for (const row of rows) {
        assert.strictEqual(
          getStatus(row, now),
          status,
          `Share ${row.id} returned by SQL query for ${status} must have getStatus == ${status}`
        );
      }

      // Verify that any row NOT returned by SQL does NOT have this status via getStatus
      const rowIds = new Set(rows.map((r) => r.id));
      for (const s of testShares) {
        if (getStatus(s, now) === status) {
          assert.ok(rowIds.has(s.id), `Share ${s.id} with status ${status} must be returned by SQL query`);
        }
      }
    }

    db.close();
  });
});
