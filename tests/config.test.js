const { test, describe } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

describe('Config Module & Security Validation (src/config.js)', () => {
  const nodeBin = process.execPath;

  function runConfigWithEnv(env) {
    return spawnSync(
      nodeBin,
      ['-e', 'require("./src/config")'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          ...env,
        },
        encoding: 'utf8',
      }
    );
  }

  test('valid configuration succeeds in development', () => {
    const res = runConfigWithEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'a_very_secure_jwt_secret_with_32_plus_chars!',
      OTP_SECRET: 'a_very_secure_otp_secret_with_32_plus_chars!',
      MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    assert.strictEqual(res.status, 0);
  });

  test('refuses to start when JWT_SECRET is shorter than 32 characters', () => {
    const res = runConfigWithEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'too_short',
      OTP_SECRET: 'a_very_secure_otp_secret_with_32_plus_chars!',
    });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /JWT_SECRET must be at least 32 characters/);
  });

  test('refuses to start when OTP_SECRET is shorter than 32 characters', () => {
    const res = runConfigWithEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'a_very_secure_jwt_secret_with_32_plus_chars!',
      OTP_SECRET: 'too_short',
    });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /OTP_SECRET must be at least 32 characters/);
  });

  test('refuses to start in production with default example MASTER_KEY', () => {
    const res = runConfigWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'prod_jwt_secret_random_and_secure_32_chars!',
      OTP_SECRET: 'prod_otp_secret_random_and_secure_32_chars!',
      MASTER_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /MASTER_KEY cannot use the public example key in production/);
  });

  test('refuses to start in production with placeholder JWT_SECRET or OTP_SECRET', () => {
    const res = runConfigWithEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'default-dev-jwt-secret-replace-in-prod-32c',
      OTP_SECRET: 'default-dev-otp-secret-replace-in-prod-32c',
      MASTER_KEY: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    });
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /cannot use default placeholder in production/);
  });
});
