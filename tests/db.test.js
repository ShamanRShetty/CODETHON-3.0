const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createTestDb } = require('./helpers');

describe('Database Layer (src/db)', () => {
  test('schema loads all 7 tables and 4 indexes', () => {
    const db = createTestDb();

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map((r) => r.name);

    const expectedTables = [
      'download_logs',
      'files',
      'notifications',
      'otp_codes',
      'share_recipients',
      'shares',
      'users',
    ];
    assert.deepStrictEqual(tables, expectedTables);

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
      )
      .all()
      .map((r) => r.name);

    const expectedIndexes = [
      'idx_files_owner',
      'idx_logs_share',
      'idx_recipients_share',
      'idx_shares_file',
    ];
    assert.deepStrictEqual(indexes, expectedIndexes);

    // Verify there is NO status column in any table (status is computed)
    for (const table of expectedTables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      const colNames = columns.map((c) => c.name.toLowerCase());
      assert.strictEqual(
        colNames.includes('status'),
        false,
        `Table ${table} must not have a 'status' column`
      );
    }

    db.close();
  });

  test('foreign keys are enforced', () => {
    const db = createTestDb();

    // Attempting to insert a file with a non-existent owner_id must fail foreign key check
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
           VALUES (999, 'test.txt', 'test.bin', 100, 'text/plain', 'key', 'iv', 'tag', 123456789)`
        ).run();
      },
      (err) => {
        return err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY/.test(err.message);
      },
      'Expected foreign key constraint violation when owner_id does not exist'
    );

    // Inserting a valid user, then inserting a file referencing that user should succeed
    const userResult = db
      .prepare(
        `INSERT INTO users (name, email, password_hash, created_at)
         VALUES ('Alice', 'alice@example.com', 'hash', 123456789)`
      )
      .run();

    const fileResult = db
      .prepare(
        `INSERT INTO files (owner_id, original_name, stored_name, size, mime, wrapped_key, iv, auth_tag, uploaded_at)
         VALUES (?, 'test.txt', 'test.bin', 100, 'text/plain', 'key', 'iv', 'tag', 123456789)`
      )
      .run(userResult.lastInsertRowid);

    assert.strictEqual(fileResult.changes, 1);

    db.close();
  });

  test('user email UNIQUE constraint is enforced', () => {
    const db = createTestDb();

    db.prepare(
      `INSERT INTO users (name, email, password_hash, created_at)
       VALUES ('Bob', 'bob@example.com', 'hash1', 123456789)`
    ).run();

    // Duplicate email insert must throw UNIQUE constraint error
    assert.throws(
      () => {
        db.prepare(
          `INSERT INTO users (name, email, password_hash, created_at)
           VALUES ('Bob Clone', 'bob@example.com', 'hash2', 123456790)`
        ).run();
      },
      (err) => {
        return err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/.test(err.message);
      },
      'Expected UNIQUE constraint violation for duplicate email'
    );

    db.close();
  });

  test('index.js exports a working database connection', () => {
    // Test that the exported connection from src/db works
    const db = require('../src/db');
    assert.ok(db);
    const pragmaFk = db.pragma('foreign_keys', { simple: true });
    assert.strictEqual(pragmaFk, 1);
  });
});
