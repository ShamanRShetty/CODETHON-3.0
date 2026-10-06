# ARCHITECTURE: VaultLink

> HOW we build what `PRD.md` describes. Humans and AI agents must follow this.
> API contract changes must be agreed by all three members and edited here **first**.

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20+ | `node:test` and `node:crypto` built in |
| Server | Express | Simple, agent-friendly |
| DB | SQLite via `better-sqlite3` | Synchronous, so transactions are trivial and safe; zero setup |
| Auth | `bcryptjs` + `jsonwebtoken` in httpOnly cookie | `bcryptjs` avoids native build issues on Windows |
| Uploads | `multer` (memory storage, size-limited) | Simple; file must be in memory to encrypt |
| Validation | `zod` | One schema per route |
| Security middleware | `helmet`, `express-rate-limit`, `cookie-parser` | |
| Mail | `nodemailer` (Ethereal) or console | Demo-safe fallback |
| Jobs | `node-cron` | Optional cleanup only; correctness never depends on it |
| Frontend | Static HTML + Tailwind CDN + vanilla JS in `public/` | One repo, one port, nothing to break |
| Tests | `node:test` | No extra dependency |

## 2. Repository layout

```
vaultlink/
├── GEMINI.md  AGENTS.md  PRD.md  ARCHITECTURE.md
├── .agent/rules/*.md        # modular agent rules
├── .agent/workflows/        # reusable agent workflows
├── .env.example  package.json
├── src/
│   ├── server.js            # app wiring only
│   ├── config.js            # env loading and validation
│   ├── db/{schema.sql,index.js,seed.js}
│   ├── lib/
│   │   ├── crypto.js        # encryptFile / decryptFile / wrapKey / unwrapKey
│   │   ├── tokens.js        # generateToken / hashToken
│   │   ├── status.js        # getStatus(share): THE status function
│   │   └── access.js        # checkAccess + consumeDownload: THE access checker
│   ├── middleware/{auth.js,rateLimit.js,validate.js}
│   ├── routes/{auth.js,files.js,shares.js,public.js,dashboard.js,notifications.js}
│   └── services/{otp.js,mailer.js,notifier.js,cleanup.js}
├── public/                  # pages + assets
├── storage/                 # encrypted blobs (gitignored)
└── tests/
```

## 3. Components

```
Browser UI ──► API routes ──► auth middleware
                  │
                  ├─► files service ──► crypto.js ──► storage/ (ciphertext only)
                  ├─► shares service ─► tokens.js, status.js
                  └─► public routes ──► access.js (checkAccess) ──► crypto.js ──► stream
                                           │
                                           └─► download_logs + notifications (SQLite)
```

- **Access checker (`src/lib/access.js`)** is the only code allowed to authorise a download.
- **Crypto module** is the only code that touches keys or ciphertext.
- **Status helper** is the only code that decides Active/Expired/Revoked/Limit.

## 4. Data model (`src/db/schema.sql`)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL            -- unix ms
);

CREATE TABLE files (
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

CREATE TABLE shares (
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

CREATE TABLE share_recipients (
  id INTEGER PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES shares(id),
  email TEXT NOT NULL                    -- stored lower-cased
);

CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES shares(id),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,               -- HMAC-SHA256(OTP_SECRET, code)
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE download_logs (
  id INTEGER PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES shares(id),
  user_email TEXT,
  ip TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL,
  reason TEXT NOT NULL,                  -- OK | NOT_FOUND | REVOKED | EXPIRED | LIMIT | NOT_ON_LIST | BAD_PASSWORD | BAD_OTP | OTP_LOCKED
  at INTEGER NOT NULL
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  share_id INTEGER REFERENCES shares(id),
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_shares_file ON shares(file_id);
CREATE INDEX idx_logs_share ON download_logs(share_id, at);
CREATE INDEX idx_recipients_share ON share_recipients(share_id);
CREATE INDEX idx_files_owner ON files(owner_id);
```

Rows for unknown tokens cannot reference a share. Log those with `share_id` NULL in a separate lightweight way, or skip DB logging and only `console.warn` them (acceptable). Do not invent a fake share row.

## 5. Encryption design (D-04)

**Envelope encryption with AES-256-GCM.**

On upload:
1. `fileKey = randomBytes(32)`, `iv = randomBytes(12)`.
2. `ciphertext, authTag = AES-256-GCM(fileKey, iv, plaintext)`.
3. Write `ciphertext` to `storage/<random>.bin`.
4. `wrapped_key = AES-256-GCM(MASTER_KEY, ivWrap, fileKey)`, stored as `iv:tag:ciphertext` base64 in `wrapped_key`.
5. Store `iv` and `auth_tag` for the file in the DB.

On download: unwrap the file key, decrypt, verify the auth tag. **If verification fails, abort with a 500 and never stream partial data.**

**Honest claim for the pitch:** "Files are encrypted at rest. A stolen disk or storage folder is unreadable." **Do NOT claim** "end-to-end" or "even we cannot read it". The server decrypts at download time.

## 6. The Access Checker (`src/lib/access.js`)

```
checkAccess({ token, otpSession, password, ip, userAgent }):
  1. share = findByTokenHash(sha256(token))      -> not found: fail NOT_FOUND
  2. share.revoked_at != null                    -> fail REVOKED
  3. now > share.expires_at                      -> fail EXPIRED
  4. max_downloads != null && download_count >= max_downloads -> fail LIMIT
  5. share.restricted:
       otpSession must be valid for THIS share and the email must be in share_recipients
       else fail NOT_ON_LIST (or BAD_OTP when handled in the OTP route)
  6. share.password_hash: bcrypt.compare(password) else fail BAD_PASSWORD
  7. return { ok: true, share, email }

consumeDownload(shareId, email, ip, ua):          -- ONE SQLite transaction
  - re-read the share row; re-check revoked/expired/limit
  - download_count = download_count + 1
  - insert download_logs (success=1, reason=OK)
  - insert notifications for the file owner
  - commit
  then decrypt and stream.
```

Rules:
- Every failure inserts a `download_logs` row (success=0, reason) and a notification, but the **HTTP response is always the same generic "unavailable" body**.
- Compare secrets with `crypto.timingSafeEqual` or bcrypt.
- Order matters: cheap checks first, bcrypt last.

## 7. Status helper (`src/lib/status.js`)

```
getStatus(share, now = Date.now()):
  if share.revoked_at            -> 'REVOKED'
  if now > share.expires_at      -> 'EXPIRED'
  if share.max_downloads != null && share.download_count >= share.max_downloads -> 'LIMIT_REACHED'
  else 'ACTIVE'
```

For list filtering by status, translate to SQL conditions that mirror this exact logic (put them in one function next to `getStatus` so they cannot drift). Add a test that asserts SQL filter results equal `getStatus` results on seeded data.

## 8. OTP flow (D-01)

1. `POST /s/:token/otp/request {email}`: if the email is on the list, generate a 6-digit code, store `HMAC(OTP_SECRET, code)` with a 5-minute expiry, send via mailer. **Always respond 200 "If this email is allowed, a code was sent"**, so the list is not revealed.
2. `POST /s/:token/otp/verify {email, code}`: check expiry, attempts (max 5; increment on each wrong code), `used` flag. On success, mark used and set a signed httpOnly cookie `otp_<shareId>` holding `{shareId, email, exp}` (expires in 30 minutes or at share expiry, whichever is sooner).
3. `checkAccess` reads and verifies that cookie. Rate-limit both endpoints by IP and by share.

## 9. API contract

All JSON, prefix `/api`, except public routes. Errors: `{ "error": "message" }` with proper status codes. Auth = cookie `session`.

### Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{name,email,password}` | `201 {id,name,email}` |
| POST | `/api/auth/login` | `{email,password}` | `200 {id,name,email}` and sets cookie |
| POST | `/api/auth/logout` | none | `204` |
| GET | `/api/auth/me` | none | `200 {id,name,email}` or `401` |

### Files (auth required, owner only)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/files` | multipart field `file`; returns `201 {id,originalName,size,uploadedAt}` |
| GET | `/api/files` | list own files with `shareCount` |
| DELETE | `/api/files/:id` | soft delete; also revokes active shares |

### Shares (auth required, owner only)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/files/:id/shares` | body `{expiresInMinutes, recipients?:string[], password?, maxDownloads?}`; returns `201 {id, link, token}`. **Token is shown once.** |
| GET | `/api/shares` | query: `q, status, from, to, sort(created\|expiry), order`; each item: `{id, fileName, status, recipients[], expiresAt, downloadCount, maxDownloads, createdAt}` |
| GET | `/api/shares/:id` | single share detail |
| POST | `/api/shares/:id/revoke` | sets `revoked_at`; returns `200 {status:'REVOKED'}` |
| GET | `/api/shares/:id/logs` | `[{at,email,ip,success,reason}]`, newest first |

### Public (no auth)
| Method | Path | Notes |
|---|---|---|
| GET | `/s/:token` | landing page (static HTML) |
| POST | `/s/:token/otp/request` | `{email}`, always `200` |
| POST | `/s/:token/otp/verify` | `{email,code}`, sets OTP cookie |
| POST | `/s/:token/download` | body `{password?}`; runs checker, streams file as attachment, or generic `404 {error:"unavailable"}` |

### Dashboard and notifications (auth required)
| Method | Path | Response |
|---|---|---|
| GET | `/api/dashboard` | `{storageBytes, fileCount, sharesByStatus:{ACTIVE,EXPIRED,REVOKED,LIMIT_REACHED}, recentActivity:[...]}` |
| GET | `/api/notifications` | list, newest first |
| POST | `/api/notifications/:id/read` | `204` |

### Download response headers (mandatory)
```
Content-Disposition: attachment; filename="<sanitised>"
Content-Type: application/octet-stream
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

## 10. UI pages (`public/`)

| Page | Purpose |
|---|---|
| `index.html` | Login / register |
| `files.html` | Upload, my files, "Share" button |
| `share-dialog` (modal in `files.html`) | expiry preset, recipients, password, max downloads, copy-once link |
| `history.html` | Shares table: status badge, search, filters, sort, Revoke button, row click opens timeline |
| `timeline.html?share=ID` | Access timeline (successes and blocked attempts) |
| `dashboard.html` | Storage, status counts, recent activity, notifications |
| `s.html` | Public recipient page: email, OTP, password, Download |

Status badge colours: ACTIVE green, EXPIRED grey, REVOKED red, LIMIT_REACHED amber.

## 11. Configuration (`.env.example`)

```
PORT=3000
BASE_URL=http://localhost:3000
JWT_SECRET=change-me-long-random
MASTER_KEY=64-hex-chars          # openssl rand -hex 32
OTP_SECRET=change-me-long-random
MAX_UPLOAD_MB=25
MAIL_MODE=console                # console | smtp
SMTP_HOST=  SMTP_PORT=  SMTP_USER=  SMTP_PASS=
```
`config.js` must refuse to start if `MASTER_KEY`, `JWT_SECRET` or `OTP_SECRET` is missing.

## 12. Ownership (prevents merge conflicts)

| Member | Owns | Tool |
|---|---|---|
| **M1: Core security** | `db/`, `lib/crypto.js`, `lib/tokens.js`, `lib/status.js`, `lib/access.js`, `routes/shares.js`, `routes/public.js`, related tests | Antigravity |
| **M2: Platform features** | `routes/auth.js`, `routes/files.js`, `middleware/`, `services/` (otp, mailer, notifier, cleanup), `routes/dashboard.js`, `routes/notifications.js`, `config.js`, `server.js` | Antigravity |
| **M3: Frontend and demo** | everything in `public/`, `db/seed.js`, README, slides, demo script | Any editor/AI tool (reads AGENTS.md) |

Changes to `schema.sql` or the API contract in this file need all three to agree.
