# Workflow: security-review

Run before every commit that touches `src/`. Report results as a short checklist artifact; do not modify code unless asked.

1. Search `src/` for any code that reads from `storage/` or calls `decryptFile`. It must only be reachable through `consumeDownload()` in `src/lib/access.js`. Report violations.
2. Search for any `status` column or code that writes a status field. There must be none.
3. Search for string-concatenated SQL (template literals or `+` inside `.prepare()` / `.exec()`). There must be none.
4. Search for `Math.random`, `Date.now()` used for tokens or codes, and `===` comparisons on secrets.
5. Confirm every route under `src/routes/` (except register, login, and `public.js`) uses the auth middleware, and checks `owner_id`.
6. Confirm download responses set `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`.
7. Search for `innerHTML` in `public/`; each use must not contain user data.
8. Confirm `.env`, `storage/`, `node_modules/` are in `.gitignore` and no secret strings appear in tracked files.
9. Run `npm test` and report the result.

Output: PASS or FAIL for each item, with file and line for any FAIL.
