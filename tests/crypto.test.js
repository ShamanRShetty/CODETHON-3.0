const { test, describe } = require('node:test');
const assert = require('node:assert');
require('./helpers');
const { encryptFile, decryptFile, wrapKey, unwrapKey } = require('../src/lib/crypto');

describe('Crypto Module (src/lib/crypto.js)', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  test('round trip: encrypt and decrypt returns original buffer', () => {
    const originalText = 'VaultLink secure file sharing plaintext payload!';
    const originalBuffer = Buffer.from(originalText, 'utf8');

    const encrypted = encryptFile(originalBuffer, masterKey);

    assert.ok(Buffer.isBuffer(encrypted.ciphertext));
    assert.strictEqual(typeof encrypted.wrappedKey, 'string');
    assert.strictEqual(typeof encrypted.iv, 'string');
    assert.strictEqual(typeof encrypted.authTag, 'string');

    const decryptedBuffer = decryptFile(encrypted, masterKey);
    assert.deepStrictEqual(decryptedBuffer, originalBuffer);
    assert.strictEqual(decryptedBuffer.toString('utf8'), originalText);
  });

  test('flipping one ciphertext byte throws an error on decrypt', () => {
    const originalBuffer = Buffer.from('Sensitive financial document contents', 'utf8');
    const encrypted = encryptFile(originalBuffer, masterKey);

    // Tamper with one byte of ciphertext
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] ^= 0xff;

    assert.throws(
      () => {
        decryptFile(
          {
            ciphertext: tamperedCiphertext,
            wrappedKey: encrypted.wrappedKey,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
          },
          masterKey
        );
      },
      /Unsupported state or unable to authenticate data|bad decrypt|authTag/i,
      'Decryption of tampered ciphertext must throw authentication error'
    );
  });

  test('tampered authTag or wrappedKey throws an error', () => {
    const originalBuffer = Buffer.from('Confidential data', 'utf8');
    const encrypted = encryptFile(originalBuffer, masterKey);

    // Tamper with authTag
    const tagBuf = Buffer.from(encrypted.authTag, 'base64');
    tagBuf[0] ^= 0x01;
    const tamperedTag = tagBuf.toString('base64');

    assert.throws(() => {
      decryptFile(
        {
          ...encrypted,
          authTag: tamperedTag,
        },
        masterKey
      );
    });

    // Tamper with wrappedKey
    const wrappedParts = encrypted.wrappedKey.split(':');
    const keyCipher = Buffer.from(wrappedParts[2], 'base64');
    keyCipher[0] ^= 0x01;
    wrappedParts[2] = keyCipher.toString('base64');
    const tamperedWrappedKey = wrappedParts.join(':');

    assert.throws(() => {
      decryptFile(
        {
          ...encrypted,
          wrappedKey: tamperedWrappedKey,
        },
        masterKey
      );
    });
  });

  test('two encryptions of the same data differ (random IV and per-file key)', () => {
    const data = Buffer.from('Same static content payload', 'utf8');

    const enc1 = encryptFile(data, masterKey);
    const enc2 = encryptFile(data, masterKey);

    assert.notDeepStrictEqual(enc1.ciphertext, enc2.ciphertext);
    assert.notStrictEqual(enc1.iv, enc2.iv);
    assert.notStrictEqual(enc1.wrappedKey, enc2.wrappedKey);
    assert.notStrictEqual(enc1.authTag, enc2.authTag);

    // But both decrypt to the exact same original content
    assert.deepStrictEqual(decryptFile(enc1, masterKey), data);
    assert.deepStrictEqual(decryptFile(enc2, masterKey), data);
  });

  test('wrapKey and unwrapKey round trip', () => {
    const fileKey = Buffer.from('01234567890123456789012345678901', 'utf8'); // 32 bytes
    const wrapped = wrapKey(fileKey, masterKey);

    assert.strictEqual(typeof wrapped, 'string');
    assert.strictEqual(wrapped.split(':').length, 3);

    const unwrapped = unwrapKey(wrapped, masterKey);
    assert.deepStrictEqual(unwrapped, fileKey);
  });
});
