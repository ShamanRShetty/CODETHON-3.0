# Rule 01: Security (non-negotiable)

Applies to all code in `src/`. Violations must be fixed before commit.

## Secrets and tokens
- Share tokens: `crypto.randomBytes(32).toString('base64url')`. Never `Math.random`, `Date.now`, or sequential IDs.
- Store only `sha256(token)` hex in `shares.token_hash`. The raw token is returned once on creation.
- Passwords: `bcryptjs`, cost 10 or higher. Share passwords too.
- OTP: 6 digits from `crypto.randomInt`, stored as `HMAC-SHA256(OTP_SECRET, code)`, 5-minute expiry, max 5 attempts, single use.
- Compare secrets with bcrypt or `crypto.timingSafeEqual`. Never `===` on secrets.
- `MASTER_KEY`, `JWT_SECRET`, `OTP_SECRET` come from `.env` only. App must refuse to start if missing.

## Authentication and authorisation
- Session = JWT in an `httpOnly`, `sameSite=lax` cookie (`secure` when not on localhost).
- Every `/api` route except register/login requires auth middleware.
- Every file/share route must check `owner_id === req.user.id`. Return 404 (not 403) for resources the user does not own.
- Registration does NOT verify email. Never grant access to a share because a logged-in user's email matches a recipient. Use OTP.

## Input handling
- Validate all inputs with `zod`; reject unknown or oversized fields.
- SQL: parameterised statements only.
- Uploads: enforce `MAX_UPLOAD_MB`; store under `crypto.randomBytes(16).toString('hex') + '.bin'`; never build a path from user input; keep `original_name` for display only and sanitise it when put into headers.
- Lower-case and trim all emails.

## Output handling
- Downloads always with:
  `Content-Disposition: attachment`, `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
- Escape all user-provided text in the frontend (use `textContent`, not `innerHTML`, for names, emails, reasons).

## Abuse protection
- `express-rate-limit` on: login, register, OTP request, OTP verify, public download.
- OTP and password failures are logged with a reason code.
- Public responses never reveal whether a token, email or recipient exists.

## Hygiene
- `helmet()` enabled. Do not expose stack traces; a global error handler returns `{error}`.
- Never log tokens, passwords, OTP codes (except `MAIL_MODE=console` mailer), file keys, or `MASTER_KEY`.
- `.env` and `storage/` are in `.gitignore`.
