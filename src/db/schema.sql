CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL            -- unix ms
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,           -- display only, never used as a path
  stored_name TEXT NOT NULL UNIQUE,      -- random hex + .bin
  size INTEGER NOT NULL,
  mime TEXT,
  wrapped_key TEXT NOT NULL,             -- file key encrypted with MASTER_KEY (base64)
  iv TEXT NOT NULL,                      -- base64, 12 bytes
  auth_tag TEXT NOT NULL,                -- base64, 16 bytes
  uploaded_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id),
  token_hash TEXT NOT NULL UNIQUE,       -- sha256(token) hex; raw token is never stored
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  max_downloads INTEGER,                 -- NULL = unlimited
  download_count INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,                    -- NULL = no password
  restricted INTEGER NOT NULL DEFAULT 0, -- 1 if recipients exist
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_recipients (
  id INTEGER PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES shares(id),
  email TEXT NOT NULL                    -- stored lower-cased
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES shares(id),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,               -- HMAC-SHA256(OTP_SECRET, code)
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES shares(id),
  user_email TEXT,
  ip TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL,
  reason TEXT NOT NULL,                  -- OK | NOT_FOUND | REVOKED | EXPIRED | LIMIT | NOT_ON_LIST | BAD_PASSWORD | BAD_OTP | OTP_LOCKED
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  share_id INTEGER REFERENCES shares(id),
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shares_file ON shares(file_id);
CREATE INDEX IF NOT EXISTS idx_logs_share ON download_logs(share_id, at);
CREATE INDEX IF NOT EXISTS idx_recipients_share ON share_recipients(share_id);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
