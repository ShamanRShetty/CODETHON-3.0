# GEMINI.md: Antigravity-specific rules for VaultLink

This file is read only by Antigravity and wins over `AGENTS.md` when they conflict.
Shared project rules live in `AGENTS.md`; keep this file short and Antigravity-specific.

## Start of every session
1. Read `PRD.md`, `ARCHITECTURE.md`, `AGENTS.md`, then the files in `.agent/rules/`.
2. Identify which team member and module the task belongs to (`ARCHITECTURE.md` section 12). Do not edit files outside that module unless asked.

## Planning and artifacts
- Use **Planning mode** for any task that touches more than one file or any file in `src/lib/`.
- Produce an **Implementation Plan** artifact first and wait for approval before coding.
- For finished tasks, produce a **Walkthrough** artifact listing: files changed, tests run, and which PRD requirement IDs (e.g. F-07, D-01) were satisfied.
- Keep tasks small. One agent = one concern (for example "OTP service" or "history table UI"). Do not request "build the whole app".

## Terminal policy
- Allowed without asking: `npm install`, `npm run dev`, `npm test`, `node --test`, `node src/db/seed.js`, `git status`, `git diff`, `git add`, `git commit`.
- Always ask first: deleting files or folders, `git push --force`, `git reset --hard`, changing `.env`, installing new dependencies.

## Browser agent (UI testing)
- After finishing a UI task, run the flow in the browser agent and attach screenshots to the Walkthrough.
- Minimum UI smoke test: register, login, upload, create share, open the public link, request OTP, download, revoke, confirm the link is dead.

## Security reminder (overrides convenience)
If a shortcut would weaken anything in `.agent/rules/01-security.md` or `02-access-checker.md`, do not take it. Explain the trade-off in the plan instead.

## Workflow
Before every commit that touches `src/`, run the `security-review` workflow (`.agent/workflows/security-review.md`).
