const { test, describe } = require('node:test');
const assert = require('node:assert');
require('./helpers');
const { generateToken, hashToken } = require('../src/lib/tokens');

describe('Tokens Module (src/lib/tokens.js)', () => {
  test('generateToken produces a 43-character base64url string', () => {
    const token = generateToken();
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 43); // 32 bytes base64url is 43 characters
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  test('generateToken produces unique tokens across calls', () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) {
      const token = generateToken();
      assert.strictEqual(tokens.has(token), false);
      tokens.add(token);
    }
    assert.strictEqual(tokens.size, 100);
  });

  test('hashToken produces a stable 64-character SHA-256 hex string', () => {
    const token = 'sample-vaultlink-token-1234567890abcdef_xyz';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    assert.strictEqual(typeof hash1, 'string');
    assert.strictEqual(hash1.length, 64);
    assert.match(hash1, /^[0-9a-f]{64}$/);
    assert.strictEqual(hash1, hash2);

    // Different tokens produce different hashes
    const differentHash = hashToken('another-token');
    assert.notStrictEqual(hash1, differentHash);
  });
});
