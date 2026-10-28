# classcharts-agent

A small, read-only CLI that gives an AI agent (or you) what a parent can see in [ClassCharts](https://www.classcharts.com): **homework, timetable, announcements, behaviour, detentions and attendance**, plus a one-shot `digest`.

```
$ classcharts digest
Alex · Wednesday 2026-10-28

Next school day · Monday 2026-11-02 · week 1
  08:30–14:45  PSHE ×2, Design and Technology ×2, Geography, Science

Homework to do (due by 2026-11-11)
  - [todo] due Wed 2026-11-04 · Art: Spellings and definitions (15 min, Miss C Teacher)

Detentions
  None.

Behaviour (last 7 days)
  3 positive (Commendation 2, Being Responsible 1), 0 negative

Announcements (last 7 days)
  - Fri 2026-10-23 · Head of School Bulletin (Mrs A Office) [2 attachments]

Attendance (this school year)
  100% (since August 100%), no absences or lates
```

It's built for family assistants: a WhatsApp group bot, Hermes, Claude Code, anything that can run a command. [SKILL.md](SKILL.md) teaches the agent which command answers which question.

> **Unofficial.** ClassCharts has no public API. This uses the same endpoints as the ClassCharts web app, as documented by the community at [classchartsapi.github.io/api-docs](https://classchartsapi.github.io/api-docs/). It may break if ClassCharts changes things. Only use it with your own account.

## Why another ClassCharts client?

[classcharts-api-js](https://github.com/classchartsapi/classcharts-api-js) is the reference this is built from, and credit to its authors. This one differs on purpose:

- **Parent login works.** It keeps every `Set-Cookie` correctly (upstream [#52](https://github.com/classchartsapi/classcharts-api-js/issues/52)), rotates the session, and logs in again only when needed.
- **It doesn't trip the rate limit.** ClassCharts blocks logins for a few minutes after too many attempts. The session is cached between runs, so an agent calling the CLI all day doesn't keep logging in.
- **Read-only by design.** There are no password changes, behaviour points, consent responses, messages or homework ticking, so it's safe to hand to an agent.
- **Agent-shaped output.** You get compact text or clean JSON: HTML stripped, rooms tidied, two-week timetable rotation detected, holidays flagged, and `next` skips to the next day with lessons.
- **No runtime dependencies and no build step.** Node runs the TypeScript directly.

## Quick start

Needs Node **23.6+**.

```bash
git clone https://github.com/shan8851/classcharts-agent.git
cd classcharts-agent
cp .env.example .env          # fill in the parent email and password
./bin/classcharts pupils      # check it works
```

That's it: no `npm install` is needed to run it. To call it from anywhere, link it onto your PATH:

```bash
ln -s "$PWD/bin/classcharts" ~/.local/bin/classcharts
```

## Give it to your agent

Point your agent at this repo and say something like: *"Install the ClassCharts skill from github.com/shan8851/classcharts-agent, then ask me for the parent login."* It should:

1. Clone the repo into its skills folder, e.g. `git clone https://github.com/shan8851/classcharts-agent.git ~/.claude/skills/classcharts`. `SKILL.md` sits at the root, so the folder is the skill.
2. Create `.env` from `.env.example`. Type the credentials in yourself rather than pasting them into a chat.
3. Run `./bin/classcharts pupils` to confirm it works.

## Commands

| Command | What it gives |
|---|---|
| `digest` | Next school day, homework to do, detentions, behaviour (7 days), announcements (7 days), attendance (this school year) |
| `day [DATE]` | Lessons plus homework due that day |
| `week [DATE]` | Mon–Fri lessons plus homework due that week |
| `homework [--from D] [--to D] [--todo] [--full]` | Homework by due date (default: 7 days back to 21 days ahead) |
| `timetable [DATE]` | Lessons only |
| `announcements [--from D] [--full]` | School announcements, flagging pinned posts and consent requests (default: last 14 days) |
| `behaviour [--from D] [--to D]` | Points with totals by reason (default: last 7 days) |
| `detentions` | Upcoming and past detentions |
| `attendance [--from D]` | Percentage plus any absences or lates (default: this school year) |
| `pupils` | Children linked to the account, and which sections their school shows |

`DATE` can be `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`, `next`, or a weekday (`mon`, `friday`: the next one, today included). `day next` means the next day with lessons, skipping weekends and holidays. `week next` means the following week.

Options: `--pupil <name|id>` when more than one child is linked, `--full` for complete homework text, links and attachments, and `--json` for structured output.

Text output is coloured in a terminal and plain when piped or run by an agent (`NO_COLOR` is respected). Exit codes: `0` success, `1` bad input or API error, `2` login problem (bad credentials, or ClassCharts' temporary block).

## Configuration

| Variable | |
|---|---|
| `CLASSCHARTS_EMAIL`, `CLASSCHARTS_PASSWORD` | Parent account login (required) |
| `CLASSCHARTS_PUPIL` | Default child, by first name or id |
| `CLASSCHARTS_ENV_FILE` | Use a different `.env` (default: the one next to `package.json`) |
| `CLASSCHARTS_SESSION_FILE` | Session cache location (default: `~/.cache/classcharts-agent/session.json`) |

The CLI loads `.env` wherever you call it from. Real environment variables take precedence.

## Privacy

Credentials stay in your `.env`. Nothing is sent anywhere except `www.classcharts.com`. The only thing stored is the session token, in a file only you can read. Delete it to sign out.

## Roadmap

- ~~Announcements, behaviour, detentions, attendance and a digest~~ (v0.2.0).
- Publish to npm (`npx classcharts-agent digest`).
- Maybe an MCP server, if agents want it more than a CLI.

What the parent API offers, and what's deliberately left out (messages, anything that writes), is in [docs/API-MAP.md](docs/API-MAP.md). Releases and changes: [CHANGELOG.md](CHANGELOG.md).

Ideas and issues are welcome.

## Development

```bash
pnpm install
pnpm check    # typecheck + tests
```

Tests use anonymised real responses in `test/fixtures/`. Never commit raw responses: `out/` and `.env` are gitignored for that reason.

## Licence

[MIT](LICENSE). Not affiliated with ClassCharts, Edukey or Tes.
