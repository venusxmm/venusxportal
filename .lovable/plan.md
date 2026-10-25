# Tasks: early completion of scheduled executions, per-occurrence only

## A. Root cause (verified in code and the live database)
1. **Task cards** (Daily Schedule, Overdue, List, Board share `renderCard`): the Complete button is `disabled` when `scheduled_date > agencyDate(now)`.
2. **Task details dialog**: the same date check is on its Complete button.
3. **Future recurring dates not yet saved** (shown as previews): their Complete goes through `task_future_action`, which today only accepts `comment`, `request_skip`, `archive`. `complete` is rejected with "Invalid future action". This is why tomorrow's 6:35 AM occurrence of "Activación más MMs de chateo de OFRF" cannot be completed even with the button enabled.
4. The database function `task_execution_action('complete')` no longer blocks future dates (removed in migration 0033). No time-of-day check exists anywhere, so "later today" is already completable once (1) is removed.

## B. Previous fix comparison
- The Creator Portal fix removed the date block from the portal button and from `task_execution_action`. The portal only lists saved executions, so it never hits path (3).
- Tasks views kept their own copies of the date check (1, 2) and also show projected future occurrences that need path (3). Verified, not assumed.

## C. Minimal shared change
- `tasks.tsx`: delete the date condition from the card button and the details button. Permissions stay as they are (`canExecute`: owner or Executive; creators via publication).
- One small migration replacing `task_future_action`: add `complete` to the allowed actions. It already calls `task_resolve_execution(task, date)` (creates or finds the single execution for that task + date, idempotent via the unique occurrence key) and then `task_execution_action(eid, 'complete')`, which runs all existing permission, Trash and purge checks.
- No other files. No new tables or columns.

## D. Recurrence and execution isolation
- Completion updates only the one row identified by task + original date (`occurrence_date`). Status and `completed_at` change; scheduled date, time, revision and the rule (`tasks`, `task_revisions`) are untouched.
- Today's and other dates' executions are separate rows and are not read or written.
- Undo calls `reopen` on that same execution id (once saved, the card is no longer projected).
- Repeated clicks: the resolve step is `ON CONFLICT DO NOTHING` on the occurrence key, so no duplicates; a second `complete` on a done row is a no-op.

## E. Risks and safeguards
- Trashed/purged dates: `task_resolve_execution` and `task_execution_action` already refuse them, so a deleted occurrence cannot be revived by completing it.
- Disabled or trashed series: no matching revision → rejected, as today.
- Overview counts and the Creator Portal read the same executions, so they reflect the change with no edits.
- Bogotá date is used only to tell saved vs projected occurrences apart, never as a permission.

## F. Focused tests (added to the existing integration suite)
1. Owner completes a projected occurrence 2 days ahead → one done row for that date; today's and the next day's stay todo; rule unchanged.
2. Same call twice → still one row.
3. Non-owner non-Executive → rejected; Executive → allowed.
4. Reopen that occurrence → todo, others untouched.
5. Completing a trashed or purged occurrence date → rejected.
6. Future one-time execution completes (already covered, keep).
Then run the task test files, plus one Executive browser check: complete tomorrow's occurrence, refresh, confirm it stays Completed and today's stays Pending.

## G. One-pass order
1. Migration: `task_future_action` accepts `complete`.
2. Remove the two date checks in `tasks.tsx`.
3. Add the tests and run them; browser check as Executive.

Not checked: Employee/Partner sessions in the browser (covered by database tests only). No publishing.
