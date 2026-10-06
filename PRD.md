# PRD: VaultLink (working name): Forward-Proof Secure File Sharing

> Hackathon: 6 hours, team of 3. This document is the **single source of truth for WHAT we build**.
> `ARCHITECTURE.md` says HOW. If the two disagree, fix them together; do not silently diverge.

## 1. Problem

People send sensitive files (marksheets, ID scans, offer letters, contracts, medical reports) over WhatsApp, email or open links. After hitting send they lose control: they do not know who opened the file, whether it was forwarded, or whether the link still works months later.

Existing open-source tools (Pingvin Share, PsiTransfer, Send) solve *link sharing with expiry*. They are weak at **identity**: a link can be forwarded, and logs show anonymous IPs, not people. Revoke and audit are shallow.

## 2. Vision and pitch line

> **Other tools share a link. We share with a person.**
> The link alone is useless. Every access attempt, successful or blocked, is logged. Revoke is instant. Files are encrypted at rest.

## 3. Users

| Persona | Need |
|---|---|
| **Sender** (registered user: student, faculty, freelancer) | Share a file with specific people, for a limited time, and stay in control afterwards |
| **Recipient** (no account needed) | Open the shared file easily after proving who they are |

## 4. Goals and non-goals

**Goals**
1. Meet every requirement in the problem statement, correctly.
2. Make security **demonstrable** in a 3-minute demo (blocked attempts, instant revoke, ciphertext on disk).
3. Be explainable: every rule is deterministic and lives in one place.

**Non-goals (do NOT build)**
- Post-quantum crypto, P2P, blockchain, decentralised identity.
- Virus scanning, S3/cloud storage, resumable uploads, file preview.
- Real-time collaboration, folders, file versioning.
- True end-to-end (zero-knowledge) encryption, unless every P0 and P1 item is done (stretch only).

## 5. Requirements

Priority: **P0** = must ship, **P1** = differentiator (this is what wins), **P2** = bonus, cut in listed order.

| ID | Requirement | PS source | Pri |
|---|---|---|---|
| F-01 | Register and login (hashed passwords, session cookie) | Req | P0 |
| F-02 | Upload a file (size limit, safe naming) | Req | P0 |
| F-03 | Download a file via a share (never directly) | Req | P0 |
| F-04 | Generate a unique, unguessable share link/code per share | Req | P0 |
| F-05 | Sender sets an expiry time per share | Req | P0 |
| F-06 | Restrict a share to selected recipients (emails) | Req | P0 |
| F-07 | Sender can revoke a share; takes effect immediately | Req | P0 |
| F-08 | History of all shares by the sender | Req | P0 |
| F-09 | Status shown: Active / Expired / Revoked / Limit reached | Req | P0 |
| F-10 | Search and filter shares (by file name, recipient, status, date range) | Req | P0 |
| F-11 | Download log per share: who (email), when, IP, success/failed + reason | Req | P0 |
| D-01 | **Email OTP** for restricted shares: recipient proves identity per access | Differentiator | P1 |
| D-02 | **Failed attempts are logged** and shown to the sender (blocked, wrong OTP, not on list) | Differentiator | P1 |
| D-03 | **Access timeline** per file/share in the UI | Differentiator | P1 |
| D-04 | **Encryption at rest** (AES-256-GCM, envelope keys) | Bonus | P1 |
| B-01 | Password-protected links | Bonus | P2 |
| B-02 | Download limit per share (concurrency-safe) | Bonus | P2 |
| B-03 | In-app notification to sender when file is accessed/downloaded or blocked | Bonus | P2 |
| B-04 | Temporary access links (short presets: 10 min, 1 h, 24 h) | Bonus | P2 |
| B-05 | Dashboard: storage used, shares by status, recent activity | Bonus | P2 |
| S-01 | Stretch: in-browser AES-GCM (key in URL fragment) | Stretch | P3 |

**Cut order if time runs short:** S-01, B-05 charts, B-04, B-03, B-01, B-02. Never cut D-01 to D-03 or any P0.

## 6. Key behaviours (acceptance criteria)

**Share creation (F-04..F-06, B-01, B-02)**
- Sender picks a file, expiry (required), optional recipient emails, optional password, optional max downloads.
- Link is shown **once** at creation with a Copy button (only a hash is stored).
- No recipients means an *open share*: anyone with the link (and password, if set) can download.
- One or more recipients means a *restricted share*: access needs a valid email OTP for a listed address.

**Access (F-03, D-01, D-02)**
- Every download request passes through the access checker (see ARCHITECTURE section 6). No exceptions.
- Any failure returns the same generic page ("This link is unavailable"). The real reason is only in the log.
- Restricted: the recipient enters their email, receives a 6-digit OTP (valid 5 minutes, max 5 attempts), then downloads.
- Registration does not verify emails, so **being logged in never proves identity**. Only OTP does.

**Revoke (F-07)**
- After clicking Revoke, the very next request on that link fails. No background job is involved.

**Status (F-09)**
Computed on every read, never stored. Priority order:
`REVOKED` > `EXPIRED` > `LIMIT_REACHED` > `ACTIVE`.

**Search and filter (F-10)**
- Text search over file name and recipient emails; filters for status and created date range; sort by created or expiry.

**Logs (F-11, D-02, D-03)**
- Each attempt stores: share, email (if known), IP, user agent, timestamp, success, reason code.
- The sender sees them as a timeline, newest first.

## 7. Non-functional requirements

- **Security:** see `.agent/rules/01-security.md` (non-negotiable).
- **Max upload:** 25 MB (configurable via `MAX_UPLOAD_MB`).
- **Runs locally** with `npm install && npm run seed && npm run dev`. No external services required (OTP can print to console).
- **Demo-safe:** no feature may depend on an external API at demo time.

## 8. Demo scenario (3 minutes)

1. Upload a file. Share with one email, 2 min expiry, 1 download.
2. Open the link as a stranger: blocked. The sender's timeline shows the blocked attempt.
3. Open as the recipient: OTP, then download succeeds. The log shows who and when.
4. Second download: blocked (limit reached).
5. Create a new share, **revoke** it live, refresh the recipient tab: dead.
6. Show the storage folder: files are unreadable ciphertext.
7. Show the dashboard.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Three people editing the same files | Module ownership table in AGENTS.md and rule 06 |
| Access logic duplicated across routes | One `checkAccess()`; rule 02 |
| Scope creep into crypto research | Non-goals list above |
| OTP email fails at demo | `MAIL_MODE=console` fallback; OTP also printed in server log |
| Time overrun on UI | P0 UI first; plain HTML + Tailwind CDN; no framework |

## 10. Team and timeline

| Hour | Milestone |
|---|---|
| 0 to 0.5 | Repo, `.env`, schema agreed, kit committed |
| 0.5 to 1.5 | Auth, DB, crypto module |
| 1.5 to 3 | Upload, share, access checker, revoke, download |
| 3 to 4 | OTP, logs, search/filter |
| 4 to 5 | Full UI, dashboard, notifications |
| 5 to 6 | Seed data, security review, rehearse, README, slides |
