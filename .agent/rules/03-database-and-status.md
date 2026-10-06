# Rule 03: Database, crypto and status

Applies to `src/db/`, `src/lib/crypto.js`, `src/lib/status.js`, `src/lib/tokens.js`.

## Database
- The schema in `ARCHITECTURE.md` section 4 is the contract. Changing a table or column needs all three team members' agreement and an edit to `ARCHITECTURE.md` first.
- Use `better-sqlite3` prepared statements. Enable `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`.
- Timestamps are unix ms integers. Booleans are `0/1`.
- `db/index.js` exports one shared connection. `db/seed.js` must be idempotent (safe to run twice) and produce: 2 users, 6 files, shares in all four statuses, and some failed and successful logs.

## Status
- `getStatus(share, now)` in `src/lib/status.js` is the only place status logic lives. Priority: REVOKED, EXPIRED, LIMIT_REACHED, ACTIVE.
- Never add a `status` column. Never run a job that changes status.
- SQL filtering by status lives right next to `getStatus` as a helper that mirrors it exactly. Test that SQL results equal `getStatus` results.

## Crypto (`src/lib/crypto.js`)
- AES-256-GCM only, via `node:crypto`. 12-byte random IV per encryption; never reuse an IV with the same key.
- Per-file random 32-byte key, wrapped with `MASTER_KEY` (also AES-256-GCM).
- Export: `encryptFile(buffer) -> {ciphertext, wrappedKey, iv, authTag}` and `decryptFile({ciphertext, wrappedKey, iv, authTag}) -> buffer`.
- Always call `decipher.setAuthTag()` and let `final()` throw on tamper. Test: flipping one byte of ciphertext must throw.
- Do not invent new algorithms, add extra ciphers, or implement post-quantum schemes.
