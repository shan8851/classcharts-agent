# Changelog

## 0.3.0 (2026-10-28)

- **On npm** as `@shan8851/classcharts-agent`: `npm install -g @shan8851/classcharts-agent`, then `classcharts`. Needs Node 22.18+ (24 recommended); clones and npm now need the same version.
- **`classcharts setup`**: a person signs in once. The password is entered hidden, tested, and saved to `~/.config/classcharts-agent/.env` (readable only by you). It refuses non-interactive input, so agents can't pipe passwords through it.
- **`classcharts skill`** prints SKILL.md, so any agent can install the skill from the npm package.
- `--version`. A clear "No ClassCharts login found" message (exit 2) when nothing is set up.
- Colour is decided per terminal by the CLI itself.
- From a full code review before the first publish:
  - `digest` now includes overdue homework that isn't ticked off (it only looked forward before).
  - `--json` stays valid JSON when the school hides a section (`hiddenBySchool`); `digest` also respects the homework setting.
  - Announcements decode `&pound;`, `&rsquo;`, numeric entities and the like, and drop `<style>`/`<script>` content.
  - Upcoming detentions are listed soonest first; detention dates are read in the school's timezone.
  - Impossible dates (`2026-13-45`) are rejected; a missing attendance percentage shows as unknown, not 0%.
  - "Next school day" says when there's none in the next three weeks instead of showing a wrong date.
  - Clearer login errors (the sign-in-page response may mean a rate limit or a wrong password); malformed login replies are an auth error.
  - `setup` always saves the login readable only by you, warns if another login file will be used instead, and ignores arrow keys and Ctrl-D in the password.
  - Two children with the same first name must be picked by id.
  - SKILL.md recipe for "homework due this week" fixed.
  - Tests for the CLI itself (digest, JSON shapes, hidden sections, exit codes) and for session edge cases: 60 in all.
- Releases publish to npm from GitHub Actions with provenance.

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
