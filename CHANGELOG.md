# Changelog

## 0.2.0 (2026-10-28)

- **`digest`**: one call for the next school day, homework to do, detentions, behaviour (last 7 days), announcements (last 7 days) and attendance (this school year).
- **New commands:** `announcements` (flags pinned posts and consent requests), `behaviour`, `detentions`, `attendance`.
- `pupils` shows which sections the school switches on. Commands for switched-off sections say so instead of erroring.
- Clearer colour in a terminal: section headings, green/red for positive/negative, yellow for todo.
- Behaviour totals are counted from the points themselves, so they always match the list.
- `docs/API-MAP.md`: every call the parent web app makes, and what's deliberately left out.

## 0.1.0 (2026-10-28)

- First release: `day`, `week`, `homework`, `timetable` and `pupils` for a parent account.
- Session cached between runs, because ClassCharts blocks logins for a few minutes after too many attempts.
- `day next` skips weekends and holidays. Two-week timetable rotation detected.
- Text output for agents and people, `--json` for programs. `SKILL.md` for agents.
