# Parent API map

Endpoints the ClassCharts parent web app (`/mobile/parent`) calls, captured by clicking through every section on 2026-10-28. All authenticated calls need the login cookies and `Authorization: Basic <session_id>` (see `src/client.ts`). `{id}` is the pupil id from `/pupils`.

Status: ✅ in the CLI · 🔜 worth adding · ⏸ not planned

| Section | Call | Status | Notes |
|---|---|---|---|
| Dashboard | `GET /apiv2parent/pupils` | ✅ | Pupil list plus feature flags (`display_*`) showing which sections the school enables, and counts (homework todo/late, detentions, announcements). |
| Dashboard | `GET /apiv2parent/announcements` | 🔜 | Same as below, but across all linked children. Not in the community docs. |
| Announcements | `GET /apiv2parent/announcements/{id}` | ✅ | `title`, `description` (HTML), `teacher_name`, `timestamp`, `attachments`, `sticky`, `priority_pinned`, `requires_consent` / `consent` (consent forms). School bulletins, trips, events. |
| Behaviour | `GET /apiv2parent/activity/{id}?from&to[&last_id]` | ✅ | Individual points: `polarity`, `score`, `reason`, `lesson_name`, `teacher_name`, `note`, `timestamp` (school local time). Pages of 10: pass the last item's `id` as `last_id` until a page is empty. `meta.last_id` is unreliable (`false` on page one). |
| Behaviour | `GET /apiv2parent/behaviour/{id}?from&to` | ⏸ | Summary: `positive_reasons` / `negative_reasons` as `{reason: count}` and a weekly `timeline`. Counts whole weeks, so it disagrees with `activity` for mid-week ranges; the CLI counts the points itself. |
| Detentions | `GET /apiv2parent/detentions/{id}` | ✅ | Empty `data` when there are none. `meta.detention_alias_plural` is the school's own word for them. |
| Attendance | `GET /apiv2parent/attendance/{id}?from&to` | ✅ (summary) | `data` maps each date to sessions (`AM`/`PM`) → `status` (present, late…), `code`, `late_minutes`. `meta.percentage` and `meta.percentage_singe_august` (sic). |
| Homework | `GET /apiv2parent/homeworks/{id}?display_date&from&to` | ✅ | Without a range the default window is 7 days back to 30 days ahead. Attachments use `filename`, not `file_name` as documented. `status.state` is often `null`; use `ticked`. |
| Timetable | `GET /apiv2parent/timetable/{id}?date` | ✅ | |
| On Report Cards | `POST /apiv2parent/getpupilreportcards` body `pupil_id` | ⏸ | A read despite the POST. Rare (only when a pupil is put "on report"). |
| Messages | `POST /apiparentmessaging/getteacherstomessage` | ⏸ | Separate messaging API, not in the community docs. Lists teachers and existing threads. |
| Messages | `POST /apiparentmessaging/getthread` body `pupil_id, teacher_id` | ⏸ | Thread metadata plus `messages`, `locked`. |
| Messages | `POST /apiparentmessaging/getmessagesforthread` body `thread_id, message_id, direction, pupil_id` | ⏸ | Paginated messages (`meta.limit`). |

## Sessions

- Login (`POST /parent/login`, form-encoded, `redirect: manual`) answers `302` with cookies; `parent_session_credentials` holds the `session_id` used as `Authorization: Basic <session_id>`.
- `POST /apiv2parent/ping` with `include_data=true` returns a fresh `meta.session_id`.
- An idle session is dead within 30 minutes (measured 2026-10-28), so agents calling a few times a day log in most times. That's fine: it's bursts of logins that trigger "Too many attempts" (about 5 minutes).

## Not planned, and why

- **Messages:** private parent–teacher conversations don't belong in a family group chat. Sending is a write, so it's out by design.
- **Write actions** (consent responses, parent behaviour points, ticking homework, password change): out by design. The CLI stays read-only.
- **Report cards:** rarely used. Revisit if a school uses them.

## Behaviour scoring (one school's example)

Points have a `reason` (e.g. "Commendation", "Being Responsible") and a `score` (1–2 for positives). Negatives have their own codes (e.g. "S1"). Reasons and scores are configured per school, so show them as given rather than interpreting them.
