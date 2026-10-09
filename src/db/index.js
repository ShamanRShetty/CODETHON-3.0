const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const dbPath = process.env.DB_PATH || config.DB_PATH || './storage/vaultlink.sqlite';

if (dbPath !== ':memory:') {
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new Database(dbPath);

db.pragma('foreign_keys = ON');
if (dbPath !== ':memory:') {
  db.pragma('journal_mode = WAL');
}

const schemaPath = path.join(__dirname, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

try {
  db.prepare('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0').run();
} catch (e) {
  // column already exists
}

module.exports = db;
module.exports.db = db;
module.exports.getDb = () => db;
module.exports.closeDb = () => {
  if (db.open) {
    db.close();
  }
};
