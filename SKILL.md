---
name: classcharts
description: Look up a child's school life from ClassCharts (UK schools) via a parent account: homework, timetable, school announcements, behaviour points, detentions and attendance. Use when someone asks what homework is due, what's on tomorrow or this week, whether it's a school day, what the school has announced, how the child's behaviour has been, about detentions or attendance, or for a daily school summary.
---

# ClassCharts (school info for a parent)

Read-only CLI for a ClassCharts parent account:

```bash
classcharts <command> [date] [options]
```

If `classcharts` isn't on the PATH but this skill folder is a clone of the repo, use `./bin/classcharts` from this folder.

## Pick the command

| Question | Command |
|---|---|
| "Anything I need to know?" / evening summary | `digest` (one call: next school day, homework to do including overdue, detentions, behaviour, announcements, attendance) |
| "What's on tomorrow?" / "Is there school Monday?" | `day tomorrow` · `day monday` |
| "What's the next school day?" (evenings, Fridays, holidays) | `day next` (skips weekends and holidays) |
| "What does this week / next week look like?" | `week` · `week next` (the following week) |
| "What homework is outstanding?" | `homework --todo` |
| "What homework is due this week?" | `week` (lessons plus homework due each day) or `homework --from today --to friday` |
| "Tell me more about the art homework" | `homework --full` (full text, links, attachment names) |
| "Has the school sent anything?" / "Any trips or forms?" | `announcements` (`--full` for the whole text) |
| "How's behaviour been this week?" | `behaviour` (`--from` for longer) |
| "Any detentions?" | `detentions` |
| "How's attendance?" | `attendance` |
| "Which children are linked?" | `pupils` (also shows which sections the school turns on) |

Dates: `YYYY-MM-DD`, `today`, `tomorrow`, `yesterday`, `next`, or a weekday (`mon`, `friday`; means the next one, today included).
Add `--json` if you need to process the result; text output is already compact.
If more than one child is linked, pass `--pupil <first name or id>`.

## Reading the output

- `[todo]` / `[done]` is whether the homework has been ticked as done in ClassCharts. It is not a teacher's mark.
- `week 1` / `week 2` is the school's two-week timetable rotation, when the school publishes it.
- "No lessons (weekend, holiday or INSET day)" means ClassCharts returned no lessons for that date. During term time, this usually means a holiday or INSET day.
- Times are in the school's timezone. Gaps between lessons are breaks or lunch.
- Behaviour reasons and scores are set by each school (e.g. "Commendation", "S1"). Report them as given; don't guess what a code means.
- `[consent needed]` on an announcement means the school wants a parent's response in ClassCharts. You can't give it; tell the parents.
- If a section says the school doesn't show it (`hiddenBySchool` in JSON), that's the school's ClassCharts setting, not an error.
- `[todo]` homework due before today is overdue: mention it first.
- Rooms and teachers are as the school records them.

## Answering well

- Lead with what matters: anything needing action (homework due soon, consent requests, detentions), then the rest.
- Celebrate positives in the family chat. Keep negatives and detentions factual and low-key; the parents decide how to handle them.
- Keep it short for a family chat: a few lines, no tables.
- Attachment links (JSON `attachments[].url`) are signed and expire. Don't post them in group chats.
- This is read-only. You can't tick homework or message teachers. Say so if asked.

## Errors

- Exit code 2: a login problem. "No ClassCharts login found": a person needs to run `classcharts setup`. "Sent the login back to its sign-in page": usually too many attempts (wait a few minutes, don't retry in a loop), otherwise a wrong email or password; tell the human. "Login failed" or "not understood": wrong details, or ClassCharts changed its login; tell the human.
- The session is cached in `~/.cache/classcharts-agent/`, so repeated calls don't log in again. Prefer one `week` call over five `day` calls anyway.
- Exit code 1: a bad date or another error. The message says what went wrong.

## Setup (once)

- Install: `npm install -g @shan8851/classcharts-agent` (Node 22.18+), or clone the repo.
- Sign in: **a person** runs `classcharts setup` in a terminal. Don't ask for the password in chat and don't try to run `setup` yourself; it refuses non-interactive input.
- Check: `classcharts pupils`. "No ClassCharts login found" (exit 2) means setup hasn't been run.
