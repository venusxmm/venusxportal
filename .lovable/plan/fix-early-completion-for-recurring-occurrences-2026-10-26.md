# Fix: early completion for recurring occurrences

## Root cause
Future recurring dates are shown as projected rows until first acted on. The backend already supports completing them (`task_future_action('complete')`, migration 0034, idempotent via the unique occurrence key), and the Tasks mutation already routes projected rows there. But the UI still disables Complete on them:
- `tasks.tsx` renderCard: `allowed` contains `!t.projected`.
- `portal.tsx`: button `disabled` contains `t.projected`, and its mutation always calls `task_execution_action` (needs a real id).

## Changes (UI only, no migration)
1. `tasks.tsx`: remove `!t.projected &&` from `allowed` in renderCard (details dialog uses the same action path).
2. `portal.tsx`: remove `t.projected` from the Complete `disabled`; mutation takes the row and, when projected, calls `task_future_action` with `_task_id` + `_date` (same as Tasks), otherwise `task_execution_action`.

Nothing else changes: recurrence rule, schedule, permissions (checked server-side), one-time path, Undo (acts on the now-real execution only).

## Checks
Run existing task tests (already cover: complete projected date 2 days ahead, other dates untouched, rule enabled, double-click idempotent, reopen that date only, non-owner rejected). Then one Playwright check as Executive: complete tomorrow's daily occurrence, refresh, it stays Completed while today's stays Pending.
