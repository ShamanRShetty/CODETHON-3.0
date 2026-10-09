# MoVo

> **Forward-Proof Secure File Sharing with Email OTP Authentication & Envelope Encryption at Rest.**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-SQLite%20(better--sqlite3)-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM%20Envelope-0052CC)](https://nodejs.org/api/crypto.html)
[![Tests](https://img.shields.io/badge/Tests-97%20Passing%20(100%25)-brightgreen)](https://nodejs.org/api/test.html)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MoVo is a modern, high-security file-sharing web application built for sharing sensitive documents with **specific people**, not just open links. Recipients prove their identity through email-based One-Time Passcodes (OTP). Every file uploaded is envelope-encrypted on the server before writing to disk using AES-256-GCM. Every access attempt—authorized, expired, revoked, or blocked—is recorded in an audit log timeline.

> **Other tools share a link. We share with a person.**  
> The link alone is useless. Every access attempt is audited. Revocation is instantaneous. Files remain encrypted at rest.

---

## 1. Key Features

### 🛡️ Security & Identity Verification
- **Email OTP Identity Challenge:** Restricted shares require the recipient to enter their email and verify a 6-digit cryptographic OTP (HMAC-SHA256 hashed, 5-minute TTL, rate-limited).
- **Envelope Encryption at Rest:** Every uploaded file receives an independent 256-bit Data Encryption Key (DEK) wrapped under the server's Master Key using AES-256-GCM with unique IVs and authentication tags.
- **Single-Door Access Control:** Only `src/lib/access.js` (`checkAccess` + `consumeDownload`) can authorise and decrypt files. Files are streamed exclusively with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- **Zero Plaintext Secrets:** Passwords hashed with `bcryptjs` (cost 10); share tokens stored as SHA-256 hashes; OTP codes stored as HMAC-SHA256 hashes.
- **Generic 404 Public Responses:** Public error responses always return an identical generic `"This link is unavailable"` to prevent user enumeration or state probing.

### ⚡ Access Control & Auditing
- **Dynamic Computed Status:** Share status (`ACTIVE`, `EXPIRED`, `REVOKED`, `LIMIT_REACHED`) is dynamically evaluated on every request—no stale database flags or background race conditions.
- **Instant Revocation:** Senders can revoke any share with a single click; access terminates in sub-millisecond time.
- **Tamper-Evident Access Timeline:** Senders can view full audit logs for each share: timestamp, IP address, user agent, success/failure status, and granular failure reason (`NOT_ON_LIST`, `BAD_OTP`, `EXPIRED`, `REVOKED`, `LIMIT`, `BAD_PASSWORD`).
- **Download Limits & Passcodes:** Optional secondary password protection and atomic download count limits.
- **In-App Notification Center:** Real-time notifications for downloads, limit completions, and blocked intruder attempts.

### 🎨 User Interface
- **Dark-Themed Glassmorphism:** Sleek UI built with Tailwind CSS and Vanilla JS.
- **Interactive File & Share Management:** Quick share creation modal with preset expirations, recipient tags, search, and filtering.

---

## 2. Quick Start & Installation

### Prerequisites
- **Node.js 20+** (LTS recommended)
- **npm 10+**

### Step-by-Step Setup

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repo-url>
   cd MoVo
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Generate a secure 256-bit (64-character hex) Master Key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Ensure your `.env` contains:
   ```env
   PORT=3000
   BASE_URL=http://localhost:3000
   JWT_SECRET=your-random-jwt-secret-min-32-chars-long
   MASTER_KEY=<paste-your-64-hex-char-master-key>
   OTP_SECRET=your-random-otp-secret-min-32-chars-long
   MAX_UPLOAD_MB=25
   MAIL_MODE=console
   ```

3. **Seed demo database:**
   ```bash
   npm run seed
   ```

4. **Start the server:**
   ```bash
   npm run dev
   ```
   Open your browser at [http://localhost:3000](http://localhost:3000).

5. **Run the test suite:**
   ```bash
   npm test
   ```

---

## 3. Pre-Seeded Demo Accounts & Links

Running `npm run seed` provisions ready-to-test accounts and files across all four statuses:

### Demo Users
| User | Email | Password | Role |
| :--- | :--- | :--- | :--- |
| **Alice (Sender)** | `alice@example.com` | `Password123!` | File Owner & Sender |
| **Bob (Recipient)** | `bob@example.com` | `Password123!` | Legitimate Recipient |

### Ready-To-Test Demo Links
- **ACTIVE (Restricted to `bob@example.com`):**  
  [http://localhost:3000/s/demo_active_share_token_alice_q1_report_12345](http://localhost:3000/s/demo_active_share_token_alice_q1_report_12345)
- **EXPIRED:**  
  [http://localhost:3000/s/demo_expired_share_token_alice_offer_letter_0](http://localhost:3000/s/demo_expired_share_token_alice_offer_letter_0)
- **REVOKED:**  
  [http://localhost:3000/s/demo_revoked_share_token_alice_passport_scan_9](http://localhost:3000/s/demo_revoked_share_token_alice_passport_scan_9)
- **LIMIT REACHED (Passcode: `Passcode123!`):**  
  [http://localhost:3000/s/demo_limit_share_token_alice_board_minutes_88](http://localhost:3000/s/demo_limit_share_token_alice_board_minutes_88)
- **ACTIVE OPEN (Bob's blueprint):**  
  [http://localhost:3000/s/demo_active_open_share_token_bob_blueprint_77](http://localhost:3000/s/demo_active_open_share_token_bob_blueprint_77)

---

## 4. Architecture & Data Flow

```
Browser UI (Static HTML + Tailwind + Vanilla JS)
      │
      ▼
Express REST API (Helmet, Rate Limiters, Cookie Parser, Zod)
      │
      ├── Auth Middleware (JWT HttpOnly Cookie)
      │
      ├── Files Service ──► AES-256-GCM Encryption ──► storage/ (Ciphertext only)
      │
      ├── Shares Service ──► Tokens (SHA-256) & Status Evaluator (Computed)
      │
      └── Public Download Gateway (src/lib/access.js)
            │
            ├── Check Access (Token + Status + Password + OTP Session)
            │
            ├── Consume & Decrypt (AES-256-GCM stream on the fly)
            │
            └── Audit Logs & Notifications (SQLite download_logs + notifications)
```

### The 5 Golden Rules of MoVo
1. **One door for files:** Only `src/lib/access.js` (`checkAccess` + `consumeDownload`) may authorise and serve a file download. No other route may read from `storage/`.
2. **Status is computed, never stored:** Status is computed dynamically with `getStatus()`.
3. **Tokens are hashed:** Share tokens are generated with 32 cryptographically random bytes; only SHA-256 hashes are persisted.
4. **Public errors are generic:** Public visitors always receive a generic 404 `"This link is unavailable"`. Real failure reasons are recorded exclusively in `download_logs`.
5. **Registration does not verify email:** Being logged in never bypasses recipient restrictions. Only a valid email OTP grants access.

---

## 5. Three-Minute Hackathon Demo Script

1. **Upload & Create Restricted Share:**
   - Log in as Alice (`alice@example.com` / `Password123!`).
   - Upload a test file (e.g. `Confidential_Brief.pdf`).
   - Create a restricted share: recipient `bob@example.com`, expiry `5 minutes`, download limit `1`.
2. **Demonstrate Blocked Stranger Access:**
   - Copy the share link and open it in an Incognito window.
   - Enter `stranger@example.com` and click **Send OTP**.
   - Generic message is displayed.
   - Switch back to Alice's dashboard -> **Timeline**: see the blocked `NOT_ON_LIST` attempt with IP and timestamp.
3. **Legitimate Recipient Download:**
   - On the share page, enter `bob@example.com` and request an OTP.
   - Read the 6-digit code printed in the server terminal (`[MoVo Mailer - Console Mode]`).
   - Enter the code, click **Verify OTP**, then click **Download**. The decrypted file downloads instantly.
4. **Download Limit & Immediate Revocation:**
   - Refresh the share page and attempt a second download -> blocked (`LIMIT_REACHED`).
   - Create a new share link, click **Revoke** in Alice's History table.
   - Reopen the link -> access is dead instantly.
5. **Inspect Ciphertext at Rest:**
   - Inspect `storage/*.bin` on disk to verify stored files are non-readable AES-256-GCM ciphertext.

---

## 6. API Reference Contract

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Create user account |
| `POST` | `/api/auth/login` | Public | Authenticate user & set JWT cookie |
| `POST` | `/api/auth/logout` | Session | Clear auth cookie |
| `GET` | `/api/auth/me` | Session | Get authenticated user profile |
| `GET` | `/api/files` | Session | List owned files with share counts |
| `POST` | `/api/files/upload` | Session | Upload & envelope-encrypt a file |
| `DELETE` | `/api/files/:id` | Session | Delete file and clean up encrypted blob |
| `POST` | `/api/files/:id/shares` | Session | Create share link (returns raw token once) |
| `GET` | `/api/shares` | Session | List shares with computed status & search/filter |
| `GET` | `/api/shares/:id` | Session | Get share metadata & recipients |
| `POST` | `/api/shares/:id/revoke` | Session | Revoke share immediately |
| `GET` | `/api/shares/:id/logs` | Session | Access log timeline for a share |
| `GET` | `/s/:token` | Public | Recipient download landing page (s.html) |
| `POST` | `/s/:token/otp/request` | Public | Request email OTP for restricted share |
| `POST` | `/s/:token/otp/verify` | Public | Verify OTP code and issue scoped OTP cookie |
| `POST` | `/s/:token/download` | Public / OTP | Authorise, decrypt, and stream file |
| `GET` | `/api/dashboard` | Session | Dashboard metrics (storage, shares by status, activity) |
| `GET` | `/api/notifications` | Session | Fetch user notifications |
| `POST` | `/api/notifications/:id/read` | Session | Mark notification as read |
| `POST` | `/api/notifications/read-all` | Session | Mark all notifications as read |

---

## 7. Repository Layout

```
├── src/
│   ├── server.js            # Express app bootstrap & middleware mounting
│   ├── config.js            # Environment variable validation (Zod)
│   ├── db/
│   │   ├── schema.sql       # SQLite DDL schema
│   │   ├── index.js         # better-sqlite3 database connection
│   │   └── seed.js          # Demo accounts, files, shares, and audit logs
│   ├── lib/
│   │   ├── crypto.js        # AES-256-GCM envelope encryption & key wrapping
│   │   ├── tokens.js        # Cryptographic random token generation & hashing
│   │   ├── status.js        # Dynamic getStatus() status evaluator
│   │   ├── access.js        # Single-door checkAccess & consumeDownload gateway
│   │   └── otpSession.js    # HMAC-signed scoped OTP session verification
│   ├── middleware/
│   │   ├── auth.js          # JWT authentication middleware
│   │   ├── rateLimit.js     # Route-specific rate limiters
│   │   └── validate.js      # Zod request validation middleware
│   ├── routes/
│   │   ├── auth.js          # Authentication routes
│   │   ├── files.js         # File upload & file management
│   │   ├── shares.js        # Share creation, listing, search & revocation
│   │   ├── public.js        # Public link gateway, OTP flow & downloads
│   │   ├── dashboard.js     # Analytics & storage usage metrics
│   │   └── notifications.js # In-app notification center
│   └── services/
│       ├── otp.js           # OTP generation, verification & timing-safe checks
│       ├── mailer.js        # Email dispatch (Console & SMTP fallback)
│       ├── notifier.js      # Notification event logger
│       └── cleanup.js       # Periodic maintenance cron job
├── public/                  # Static frontend (HTML5 + Tailwind CSS + Vanilla JS)
├── storage/                 # Encrypted ciphertext storage (.bin files)
└── tests/                   # 97 unit, integration & security attack tests (node:test)
```

---

## 8. Verification & Test Suite

MoVo includes 97 automated tests across 15 test suites covering cryptography, access authorization, dynamic status computation, token security, OTP challenges, rate limiting, and end-to-end user flows alongside dedicated hostile security attack tests.

```bash
# Run all tests
npm test
```

```
✔ Project Skeleton (4 tests)
✔ Configuration & Security Validation (6 tests)
✔ Database & Schema Constraints (6 tests)
✔ Cryptography & Key Wrapping (8 tests)
✔ Tokens Generation & Hashing (3 tests)
✔ Dynamic Status Evaluator (8 tests)
✔ OTP Generation & Concurrency-Safe Verification (7 tests)
✔ Authentication & Token Revocation API (7 tests)
✔ Files Upload & Management API (6 tests)
✔ Shares Management & Filtering API (9 tests)
✔ Access Checker & Pre-Decryption Quota Reservation (10 tests)
✔ Public Gateway, OTP Challenge & IP-Bound Downloads (11 tests)
✔ Dashboard Metrics API (5 tests)
✔ Notification Center & Batch Read API (5 tests)
✔ Full End-to-End Sharing Workflow (2 tests)

15 test suites | 97 tests passing | 0 failing
```
