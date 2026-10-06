# Rule 02: The Access Checker is the only door

Applies to `src/lib/access.js`, `src/routes/public.js`, `src/routes/shares.js`.

1. Only `checkAccess()` and `consumeDownload()` may decide whether a file is served. No other route may read, decrypt or stream from `storage/`, including admin or debug routes.
2. Check order is fixed (see `ARCHITECTURE.md` section 6):
   token found, revoked, expired, download limit, recipient/OTP, password.
   Cheap checks first, bcrypt last.
3. Every failure writes a `download_logs` row (`success=0`, with a reason from the allowed list) and creates an owner notification. The HTTP response is the same generic `404 {"error":"unavailable"}` for all failures.
4. `consumeDownload()` runs in ONE `better-sqlite3` transaction that re-validates revoked/expired/limit, increments `download_count`, writes the success log, and writes the owner notification. Only after the transaction commits do we decrypt and stream.
5. If decryption or auth-tag verification fails: respond `500`, do not send any partial bytes, log the error without secrets.
6. Revocation must work with zero delay: the checker reads the DB on every request. No caching of share state.
7. Required tests in `tests/access.test.js` (one per branch):
   unknown token, revoked, expired, limit reached, restricted without OTP, restricted with OTP for a different email, wrong password, success, **concurrent downloads on a limit of 1 allow exactly one**.

Allowed reason codes:
`OK, NOT_FOUND, REVOKED, EXPIRED, LIMIT, NOT_ON_LIST, BAD_PASSWORD, BAD_OTP, OTP_LOCKED`
