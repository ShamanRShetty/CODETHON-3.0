const { test, describe } = require('node:test');
const assert = require('node:assert');
const { createTestDb } = require('./helpers');

describe('Project Skeleton', () => {
  test('creates in-memory database with schema', () => {
    const db = createTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.ok(tables.includes('users'));
    assert.ok(tables.includes('files'));
    assert.ok(tables.includes('shares'));
    assert.ok(tables.includes('share_recipients'));
    assert.ok(tables.includes('otp_codes'));
    assert.ok(tables.includes('download_logs'));
    assert.ok(tables.includes('notifications'));
    db.close();
  });

  test('server exports express application', () => {
    const app = require('../src/server');
    assert.ok(typeof app === 'function');
  });

  test('modules export expected functions and stubs', () => {
    const crypto = require('../src/lib/crypto');
    assert.ok(typeof crypto.encryptFile === 'function');
    assert.ok(typeof crypto.decryptFile === 'function');
    assert.ok(typeof crypto.wrapKey === 'function');
    assert.ok(typeof crypto.unwrapKey === 'function');

    const tokens = require('../src/lib/tokens');
    assert.ok(typeof tokens.generateToken === 'function');
    assert.ok(typeof tokens.hashToken === 'function');

    const status = require('../src/lib/status');
    assert.ok(typeof status.getStatus === 'function');
    assert.ok(typeof status.getStatusSqlFilter === 'function');

    const access = require('../src/lib/access');
    assert.ok(typeof access.checkAccess === 'function');
    assert.ok(typeof access.consumeDownload === 'function');
  });

  test('server responds to /api/health', async () => {
    const app = require('../src/server');
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.deepStrictEqual(data, { status: 'ok' });
    } finally {
      server.close();
    }
  });
});
