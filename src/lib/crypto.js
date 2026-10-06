const crypto = require('node:crypto');
const config = require('../config');

function getMasterKeyBuffer(customKey) {
  const keyHex = customKey || process.env.MASTER_KEY || config.MASTER_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('MASTER_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

function wrapKey(fileKey, masterKey) {
  const masterKeyBuf = getMasterKeyBuffer(masterKey);
  const ivWrap = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKeyBuf, ivWrap);
  const ciphertext = Buffer.concat([cipher.update(fileKey), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ivWrap.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function unwrapKey(wrappedKey, masterKey) {
  const masterKeyBuf = getMasterKeyBuffer(masterKey);
  const parts = wrappedKey.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid wrapped key format');
  }

  const [ivBase64, tagBase64, cipherBase64] = parts;
  const ivWrap = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(tagBase64, 'base64');
  const ciphertext = Buffer.from(cipherBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKeyBuf, ivWrap);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptFile(buffer, masterKey) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  const fileKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', fileKey, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const wrappedKey = wrapKey(fileKey, masterKey);

  return {
    ciphertext,
    wrappedKey,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptFile({ ciphertext, wrappedKey, iv, authTag }, masterKey) {
  const fileKey = unwrapKey(wrappedKey, masterKey);

  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, 'base64');
  const tagBuf = Buffer.isBuffer(authTag) ? authTag : Buffer.from(authTag, 'base64');
  const cipherBuf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', fileKey, ivBuf);
  decipher.setAuthTag(tagBuf);
  return Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
}

module.exports = {
  wrapKey,
  unwrapKey,
  encryptFile,
  decryptFile,
};
