# MoVo

> Secure, Expiring, and Revocable File Sharing with Email OTP Authentication and Envelope Encryption at Rest.

MoVo is a secure file-sharing web application designed for sharing sensitive files with specific recipients. Recipients authenticate their identity using email-based one-time passcodes (OTP). Uploaded files are envelope-encrypted at rest with AES-256-GCM. Every access attempt—whether authorized, expired, revoked, or blocked—is recorded in an immutable audit timeline.

> **Security & Cryptography Notice:** MoVo uses **envelope encryption at rest** (files are encrypted on the server before writing to disk with AES-256-GCM and unique per-file keys wrapped under a master key). MoVo is **not** an end-to-end encrypted (E2EE) client application; files are decrypted on the server upon authenticated, authorized download and streamed directly to the recipient.

---

## 1. Quick Start & Setup

### Prerequisites
- Node.js 20+ (LTS recommended)
- npm 10+

### Setup Instructions

1. **Clone and install dependencies:**
   ```bash
   git clone <repo-url>
   cd CODETHON-3.0
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Generate a secure 256-bit (64-character hex) Master Key:
   ```bash
   openssl rand -hex 32
   ```

   Ensure your `.env` file contains:
   ```env
   PORT=3000
   BASE_URL=http://localhost:3000
   JWT_SECRET=your-random-jwt-secret-min-32-chars
   MASTER_KEY=<paste-your-64-hex-char-master-key>
   OTP_SECRET=your-random-otp-secret-min-32-chars
   MAX_UPLOAD_MB=25
   MAIL_MODE=console
   ```

3. **Seed demo database:**
   ```bash
   npm run seed
   ```

4. **Start development server:**
   ```bash
   npm run dev
   # Server listening at http://localhost:3000
   ```

5. **Run tests:**
   ```bash
   npm test
   ```

---

## 2. Seeded Demo Accounts

The database seed (`npm run seed`) provisions two active demo accounts with pre-populated files, shares across all 4 statuses, and audit history:

| User | Email | Password | Role in Demo |
| :--- | :--- | :--- | :--- |
| **Alice** | `alice@example.com` | `Password123!` | File Owner / Sender |
| **Bob** | `bob@example.com` | `Password123!` | Recipient / Downloader |

---

## 3. Architecture Overview

```
Browser UI (Static HTML + Tailwind + Vanilla JS)
      │
      ▼
Express REST API (Helmet, Rate Limits, Cookie Parser, Zod)
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
            ├── Consume & Decrypt (AES-256-GCM on the fly)
            │
            └── Audit Logs & Notifications (SQLite download_logs + notifications)
```

### Core Architecture Principles
- **One Door for Downloads:** Only `src/lib/access.js` (`checkAccess` + `consumeDownload`) can read from `storage/` and decrypt file data.
- **Computed Status:** Status (`ACTIVE`, `EXPIRED`, `REVOKED`, `LIMIT_REACHED`) is always dynamically calculated per request and never stored statically in the database.
- **Hashed Tokens & OTPs:** Share tokens are generated with 32 cryptographically random bytes; only their SHA-256 hashes are stored. OTPs are stored as HMAC-SHA256 hashes with 5-minute TTL.
- **Generic Public Responses:** Public error responses always return an identical generic 404 `"This link is unavailable"` to prevent information leakage.
- **Attachment Only:** Files are streamed strictly with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

---

## 4. Security Checklist

- [x] **Encryption at Rest:** Envelope encryption with AES-256-GCM. Each file has an independent 256-bit data encryption key (DEK) wrapped under `MASTER_KEY`.
- [x] **Constant-Time Verification:** Secrets and OTP hashes are compared using `crypto.timingSafeEqual()`.
- [x] **Zero Plaintext Secrets:** Passwords hashed with `bcryptjs` (cost 10); share tokens hashed with SHA-256; OTPs hashed with HMAC-SHA256.
- [x] **Strict Parameterised Queries:** 100% parameterised SQL using `better-sqlite3` with `?` placeholders.
- [x] **XSS Prevention:** Frontend uses safe DOM `textContent` assignments for all dynamic data.
- [x] **Rate Limiting:** IP and endpoint rate limiters applied on auth, OTP request, OTP verify, and file downloads.
- [x] **Clean Ignored Boundaries:** `.env`, `storage/`, and database binaries are fully excluded in `.gitignore`.

---

## 5. Three-Minute Demo Scenario

1. **Upload & Create Restricted Share:**
   - Log in as Alice (`alice@example.com`).
   - Upload a test file (e.g. `confidential_brief.pdf`).
   - Create a restricted share: recipient `bob@example.com`, 2-minute expiry, max 1 download.
2. **Unauthorized Stranger Access:**
   - Copy the share link and open it in a private/second window.
   - Click "Continue" and attempt to request OTP for `stranger@example.com` or download without authorization.
   - Access is blocked with generic `"This link is unavailable"`.
   - In Alice's account, inspect the timeline to see the blocked access attempt in real time.
3. **Authorized Recipient Download:**
   - On the share page, enter `bob@example.com` and request an OTP.
   - Read the 6-digit OTP code printed in the server console (`[MoVo Mailer - Console Mode]`).
   - Enter the OTP code, verify, and click "Download". The decrypted file downloads immediately.
4. **Download Limit Enforcement:**
   - Re-attempt the download on the same link.
   - The second download is instantly blocked (`LIMIT_REACHED` in audit logs).
5. **Live Revocation:**
   - Create a new share link for any file.
   - In Alice's History table, click **Revoke** and confirm.
   - Open or refresh the link: access fails immediately without waiting for background jobs.
6. **Inspect Ciphertext at Rest:**
   - Inspect the `storage/` folder on disk to demonstrate that stored `.bin` files are unreadable encrypted ciphertext.
7. **Review Dashboard & Notifications:**
   - View the dashboard storage utilization cards, status distribution, and notification center.

---

## 6. Demo Readiness Checklist

- [x] Clean run: `npm install && npm run seed && npm run dev` works out of the box.
- [x] Seed data contains shares in all four statuses (`ACTIVE`, `EXPIRED`, `REVOKED`, `LIMIT_REACHED`) with corresponding logs.
- [x] `MAIL_MODE=console` outputs clear, formatted OTP verification codes in the server terminal.
- [x] Instant live revocation working in under 1 second.
- [x] Unreadable encrypted `.bin` files verified in `storage/`.
- [x] Comprehensive test suite: 82 tests passing across 14 test suites (`npm test`).
