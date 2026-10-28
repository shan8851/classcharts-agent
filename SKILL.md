---
name: classcharts
description: Look up a child's school homework and timetable from ClassCharts (UK schools) via a parent account. Use when someone asks what homework is due, what's outstanding, what lessons are on a day or this week, whether it's a school day, or what kit/books are needed for tomorrow.
---

# ClassCharts (homework and timetable)

Read-only CLI for the ClassCharts parent account. Run it from this folder:

```bash
./bin/classcharts <command> [date] [options]
```

## Pick the command

| Question | Command |
|---|---|
| "What's on tomorrow?" / "Is there school Monday?" | `day tomorrow` · `day monday` |
| "What's the next school day?" (evenings, Fridays, holidays) | `day next` (skips weekends and holidays) |
| "What does this week / next week look like?" | `week` · `week next` (the following week) |
| "What homework is outstanding?" | `homework --todo` |
| "What homework is due this week?" | `homework --from monday --to friday` |
| "Tell me more about the art homework" | `homework --full` (full text, links, attachment names) |
| "Which children are linked?" | `pupils` |

Dates: `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`, `next`, or a weekday (`mon`, `friday`; means the next one, today included).
Add `--json` if you need to process the result; text output is already compact.
If more than one child is linked, pass `--pupil <first name or id>`.

## Reading the output

- `[todo]` / `[done]` is whether the homework has been ticked as done in ClassCharts. It is not a teacher's mark.
- `week 1` / `week 2` is the school's two-week timetable rotation, when the school publishes it.
- "No lessons (weekend, holiday or INSET day)" means ClassCharts returned no lessons for that date. During term time, this usually means a holiday or INSET day.
- Times are in the school's timezone. Gaps between lessons are breaks or lunch.
- Rooms and teachers are as the school records them.

## Answering well

- Lead with what matters: what's due soonest, and anything that needs kit (PE, art materials, cooking).
- Keep it short for a family chat: a few lines, no tables.
- Attachment links (JSON `attachments[].url`) are signed and expire. Don't post them in group chats.
- This is read-only. You can't tick homework or message teachers. Say so if asked.

## Errors

- Exit code 2: a login problem. "Too many attempts" means ClassCharts is blocking logins for a few minutes: wait, don't retry in a loop. "Login failed" means the parent email/password in `.env` is wrong, or ClassCharts changed its login: tell the human.
- The session is cached in `~/.cache/classcharts-agent/`, so repeated calls don't log in again. Prefer one `week` call over five `day` calls anyway.
- Exit code 1: a bad date or another error. The message says what went wrong.

## Setup (once)

Needs Node 23.6+ (runs TypeScript directly, no build). Copy `.env.example` to `.env` and fill in the parent login. See README.md.
