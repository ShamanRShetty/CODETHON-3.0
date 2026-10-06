# AGENTS.md: VaultLink

Cross-tool instructions for any AI coding agent or human on this repo
(Antigravity, Cursor, Claude Code, Copilot, etc.).

## What we are building
A secure file-sharing web app: users upload files and share them with **specific people** using expiring, revocable links. Recipients prove identity with an **email OTP**. Every access attempt, successful or blocked, is logged. Files are **encrypted at rest** (AES-256-GCM).

**Read before coding, always:**
1. `PRD.md`: what and why
2. `ARCHITECTURE.md`: how (schema, API contract, access checker)
3. `.agent/rules/*.md`: detailed rules

If a task conflicts with these documents, **stop and ask**. Do not improvise a different design.

## Stack
Node.js 20+, Express, SQLite (`better-sqlite3`), `bcryptjs`, `jsonwebtoken`, `multer`, `zod`, `helmet`, `express-rate-limit`, `nodemailer`, `node-cron`. Frontend: static HTML + Tailwind CDN + vanilla JS in `public/`. Tests: `node:test`.

## Commands
```
npm install
npm run seed      # demo data
npm run dev       # start server (nodemon or node --watch)
npm test          # node --test tests/
```

## The five golden rules
1. **One door for files.** Only `src/lib/access.js` (`checkAccess` + `consumeDownload`) may authorise and serve a file download. No other route may read from `storage/`.
2. **Status is computed, never stored.** Use `getStatus()` from `src/lib/status.js` everywhere.
3. **Tokens are hashed.** Generate with `crypto.randomBytes(32)`; store only the SHA-256 hash; show the raw token once.
4. **Public errors are generic.** Visitors always see "unavailable". The real reason goes only into `download_logs`.
5. **Registration does not verify email.** Being logged in never grants access to someone else's share. Only a valid OTP does.

## Conventions
- CommonJS (`require`) unless the repo already uses ESM; do not mix.
- SQL: parameterised statements only (`?` placeholders). No string-built SQL.
- Validate every request body/query with `zod` before using it.
- Timestamps: unix milliseconds (integers).
- Emails: lower-case and trim before storing or comparing.
- Files under 300 lines; one responsibility per module.
- Never log secrets, tokens, passwords, OTPs (the OTP console mailer is the only exception, and only when `MAIL_MODE=console`).
- Never commit `.env` or `storage/`.

## How to work (agents and humans)
- **Plan first.** Produce a short plan, then implement in small steps. One task = one concern.
- Stay inside the files you own (see ownership in `ARCHITECTURE.md` section 12). If you must touch someone else's file, say so in the commit message and tell them.
- Add or update a test for every new behaviour in `lib/` and for each access-checker branch.
- Do not add dependencies without need. Never add a dependency that needs a database server, Docker or cloud account.
- Do not rename API paths, response shapes or DB columns. They are a contract with the frontend.

## Definition of done (per task)
- [ ] Behaviour matches PRD and the ARCHITECTURE contract
- [ ] `npm test` passes
- [ ] No secrets in code or logs
- [ ] Security checklist in `.agent/rules/01-security.md` still holds
- [ ] Committed on your own branch with a clear message

## Do NOT
- Build post-quantum crypto, P2P, blockchain, cloud storage, or a virus scanner.
- Serve uploaded files inline in the browser (always `attachment`).
- Trust the client's filename, MIME type, or any ID without an ownership check.
- Add a background job that flips statuses.
