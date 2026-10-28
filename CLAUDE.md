# classcharts-agent

Read-only ClassCharts CLI + agent skill (homework, timetable) for a parent account. Public repo (MIT). First user: a family WhatsApp bot (Hermes), so keep it generic.

## Rules

- **Read-only.** Don't add write endpoints (tick homework, behaviour, password, messages) without Shan asking.
- **Nothing personal in the repo.** No child names, school, teachers, ids or raw responses. `.env` and `out/` are gitignored. Fixtures in `test/fixtures/` are anonymised; check with a grep before committing new ones.
- **Generic over school-specific.** Some schools' MIS quirks (e.g. encoded period names, room prefixes) are handled by pattern, never by hard-coding a school.
- No runtime dependencies. Node 23.6+ runs `src/*.ts` directly; `tsc` is typecheck-only (`erasableSyntaxOnly`), so no enums or namespaces.
- `pnpm check` (tsc + vitest) before calling anything done. Live check: `./bin/classcharts day next` (needs `.env`).

## Layout

- `src/client.ts`: login, session refresh/relogin, `pupils`, `homeworks`, `timetable`
- `src/session.ts`: on-disk session cache. ClassCharts rate-limits logins ("Too many attempts", ~5 min), so never log in per call
- `src/format.ts`: raw → normalised shapes, and text rendering
- `src/dates.ts`: date words, school weeks, timezone
- `src/cli.ts`: commands; `bin/classcharts` is the launcher
- `SKILL.md`: what the agent reads

API reference: https://classchartsapi.github.io/api-docs/ (unofficial; some field names are wrong, e.g. attachments use `filename`). Trust real responses over the docs.

## Next

- Map the rest of the parent API by clicking through ClassCharts in Chrome with network capture, then decide what's worth adding (announcements, detentions, attendance…).
- npm package later (see README roadmap). Node does not strip types inside node_modules, so npm needs a small build step to `dist/`.
- MCP server: undecided.

Personal working notes live in `CLAUDE.local.md` (gitignored). This repo is meant to be public.
