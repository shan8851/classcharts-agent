# classcharts-agent

Read-only ClassCharts CLI + agent skill (homework, timetable, announcements, behaviour, detentions, attendance, digest) for a parent account. Public repo (MIT). First user: a family WhatsApp bot (Hermes), so keep it generic.

## Rules

- **Branches and PRs.** Work on a branch, open a PR, let CI pass. Release: bump `package.json`, add a `CHANGELOG.md` entry, merge, then publish a GitHub release `vX.Y.Z`; `.github/workflows/release.yml` publishes to npm.

- **Read-only.** Don't add write endpoints (tick homework, behaviour, password, messages) without Shan asking.
- **Nothing personal in the repo.** No child names, school, teachers, ids or raw responses. `.env` and `out/` are gitignored. Fixtures in `test/fixtures/` are anonymised; check with a grep before committing new ones.
- **Generic over school-specific.** Some schools' MIS quirks (e.g. encoded period names, room prefixes) are handled by pattern, never by hard-coding a school.
- No runtime dependencies. Clones run `src/*.ts` directly on Node 23.6+ (`erasableSyntaxOnly`, so no enums or namespaces). npm ships `dist/` (built with `pnpm build`), which must keep working on Node 20.12: no newer Node APIs without a fallback.
- `pnpm check` (tsc + vitest) before calling anything done. Live check: `./bin/classcharts day next` (needs `.env`).

## Layout

- `src/client.ts`: login, session refresh/relogin, `pupils`, `homeworks`, `timetable`
- `src/session.ts`: on-disk session cache. ClassCharts rate-limits logins ("Too many attempts", ~5 min), so never log in per call
- `src/format.ts`: homework/timetable shapes, text rendering, styles
- `src/sections.ts`: announcements, behaviour, detentions, attendance
- `src/dates.ts`: date words, school weeks, timezone
- `src/cli.ts`: commands; `bin/classcharts` is the clone launcher, `dist/cli.js` the npm one
- `src/setup.ts`: interactive sign-in, saved to `~/.config/classcharts-agent/.env`
- `SKILL.md`: what the agent reads

API reference: https://classchartsapi.github.io/api-docs/ (unofficial; some field names are wrong, e.g. attachments use `filename`). Trust real responses over the docs.

## Next

- Parent API map: `docs/API-MAP.md`. Keep it updated when adding endpoints.
- MCP server: undecided.

Personal working notes live in `CLAUDE.local.md` (gitignored). This repo is meant to be public.
