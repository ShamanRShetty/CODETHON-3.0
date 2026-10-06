# Rule 04: API conventions and frontend

## API (M1, M2)
- Paths, methods, request and response shapes follow `ARCHITECTURE.md` section 9 exactly. If you need a new field, add it to the doc in the same PR and tell M3.
- JSON in, JSON out. Errors are `{ "error": "message" }` with correct status codes (400 validation, 401 unauthenticated, 404 not found or not yours, 409 conflict, 429 rate limited, 500 server).
- Each route file exports an Express router; `server.js` only wires middleware and routers.
- Validate with `zod` in a small middleware (`validate(schema)`), not inline.
- Search/filter on `GET /api/shares` runs in SQL, not in JavaScript, and supports `q, status, from, to, sort, order`.

## Frontend (M3)
- Static files in `public/`. Tailwind via CDN, vanilla JS (`fetch` with `credentials: 'same-origin'`). No build step, no framework.
- One shared `public/js/api.js` wrapper for all fetch calls; handle `401` by redirecting to login.
- Render user-provided text with `textContent` only. Never `innerHTML` with user data.
- Status badges: ACTIVE green, EXPIRED grey, REVOKED red, LIMIT_REACHED amber. Always show the badge as text plus colour.
- The share link is shown once, in a modal with a Copy button and a warning "You will not see this link again".
- The public page `s.html` must work for a person with no account: email, then OTP, then (optional) password, then Download.
- Every page must be demo-ready on a 1366x768 screen. Empty states and error messages must be friendly.
- Do not call any external API at runtime (Tailwind CDN excepted; keep a local fallback CSS if possible).
