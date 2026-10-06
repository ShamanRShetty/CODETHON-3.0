# Rule 05: Team workflow (3 people, 6 hours)

## Ownership (from ARCHITECTURE.md section 12)
- **M1 Core security:** `db/`, `lib/*`, `routes/shares.js`, `routes/public.js`
- **M2 Platform:** `routes/auth.js`, `routes/files.js`, `middleware/`, `services/`, `routes/dashboard.js`, `routes/notifications.js`, `config.js`, `server.js`
- **M3 Frontend and demo:** `public/`, `db/seed.js`, README, slides

Do not edit another member's files without telling them in chat. Shared files (`schema.sql`, `ARCHITECTURE.md`, `package.json`) are edited by one person at a time; announce before touching them.

## Git
- `main` always runs. Never push broken code to `main`.
- Each member works on their own branch: `m1/core`, `m2/platform`, `m3/frontend`.
- Commit small and often. Format: `type(scope): message`, for example `feat(access): add limit check`, `fix(ui): escape file names`.
- `git pull --rebase origin main` before starting each work block.
- Merge to `main` at least once per hour (at the hour mark). Run `npm test` before merging.
- Do not commit `.env`, `storage/`, `node_modules/`, or `*.sqlite`.

## Contract-first integration
- M3 builds the UI against the API contract in `ARCHITECTURE.md`. Until real endpoints exist, use hard-coded sample JSON with the exact same shapes.
- M1 and M2 post a short message in team chat when an endpoint becomes real.
- If a contract change is needed, edit `ARCHITECTURE.md` first, tell everyone, then code.

## Agent usage
- Each Antigravity user runs agents scoped to their own module only.
- The third member may use any AI tool; point it at `AGENTS.md`, `PRD.md` and `ARCHITECTURE.md` at the start.
- Agents never push to `main` and never force-push.

## Last hour freeze
- At hour 5: no new features. Only bug fixes, seed data, README, and demo rehearsal.
