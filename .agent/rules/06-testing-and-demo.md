# Rule 06: Testing and demo readiness

## Tests (`node --test tests/`)
Minimum set:
- `crypto.test.js`: round-trip; tampered ciphertext throws; two encryptions of same data differ.
- `status.test.js`: each status, plus priority order (revoked beats expired).
- `access.test.js`: every branch in rule 02, including the concurrency test.
- `otp.test.js`: correct code works; wrong code increments attempts; 6th attempt locks; expired code fails; code is single use.
- `shares.test.js`: non-owner cannot revoke or read logs (gets 404); search and filter return expected rows.

Use a fresh in-memory or temp SQLite DB per test file. Tests must not need the network.

## Demo readiness (check at hour 5)
- [ ] `npm install && npm run seed && npm run dev` works on a clean clone
- [ ] Seed data contains shares in all four statuses and both successful and blocked log entries
- [ ] Two browser profiles prepared: sender and recipient
- [ ] `MAIL_MODE=console` works and the OTP is visible in the terminal
- [ ] A 25 MB file and a small PDF are ready for upload
- [ ] The storage folder shows unreadable `.bin` files (for the encryption demo)
- [ ] Revoke demo works live in under 5 seconds
- [ ] README has setup steps, architecture diagram, and the security checklist
- [ ] Slides: problem, existing work (Pingvin Share, PsiTransfer, Send), our difference, demo, future work (zero-knowledge, post-quantum)
