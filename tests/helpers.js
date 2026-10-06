const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Set predictable test environment variables if not already set
process.env.MASTER_KEY =
  process.env.MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-32-chars-long!!';
process.env.OTP_SECRET = process.env.OTP_SECRET || 'test-otp-secret-key-32-chars-long!!';
process.env.MAIL_MODE = process.env.MAIL_MODE || 'console';
process.env.MAX_UPLOAD_MB = process.env.MAX_UPLOAD_MB || '25';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function resetDb(dbInstance) {
  const targetDb = dbInstance || require('../src/db');
  targetDb.prepare('DELETE FROM notifications').run();
  targetDb.prepare('DELETE FROM download_logs').run();
  targetDb.prepare('DELETE FROM share_recipients').run();
  targetDb.prepare('DELETE FROM otp_codes').run();
  targetDb.prepare('DELETE FROM shares').run();
  targetDb.prepare('DELETE FROM files').run();
  targetDb.prepare('DELETE FROM users').run();
}

module.exports = {
  createTestDb,
  resetDb,
  schemaSql,
};
