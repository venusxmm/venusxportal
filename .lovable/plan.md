# Creator Portal: Recurring Task Shown Many Times, Completed Task Still "Pending"

## A. Verified root causes

Both bugs have one cause, and it is in the portal list, not in the stored data.

- **The data is clean.** No task has two live executions on the same date. One duplicate pair exists, but both rows are cancelled and hidden. A database uniqueness rule already guarantees one live execution per task per date (`task_execution_occurrence_unique` on task + occurrence date, ignoring cancelled rows). No recurring rule has overlapping revisions.
- **The portal asks for 7 days back to 14 days ahead** (`portal.tsx` calls `creator_portal_tasks(today-7, today+14)`). For a daily task, that request returns today's stored execution plus a not-yet-created placeholder for each of the next 14 days.
- **The portal shows every one of those rows.** Example: "Airbnb" (daily, shared with the creator) is done for Oct 25. The portal shows it once under Completed with Undo, plus 14 "Airbnb · Pending" cards for Oct 26 to Nov 8 in My tasks. That is what reads as "duplicated" and "still Pending after Complete". Completing today saves correctly (status done on that one execution). The Pending cards are the other days.
- **Roadmap Progress is also wrong.** It divides by all those rows, so one daily task counts as 15.
- **The new day does not appear while the portal stays open.** The list only refetches on open or when the window regains focus, never at Bogotá midnight.

Hypotheses ruled out: duplicate rows, unstable IDs, writes to the rule instead of the execution, stale cache. Complete and Undo already call `task_execution_action` on the one execution, and the result shows after refetch.

## B. Minimal changes (one file plus one test, no migration)

`src/routes/_authenticated/portal.tsx`:
1. **Show recurring tasks only up to today.** Recurring rows dated after today (Bogotá) are hidden, whether they are placeholders or already stored. Past rows stay: overdue ones under My tasks, completed ones under Completed. One-time tasks keep their current behaviour, so future-dated ones stay visible and view-only.
2. **Base Roadmap Progress on the same filtered list.** This removes the inflation from future copies.
3. **Midnight rollover.** A minute-aligned timer using the existing `msToNextMinute` checks `agencyDate()`. When the Bogotá date changes, it refetches the portal tasks. Each fetch already computes "today" fresh.

Add a small pure helper, `portalVisible(rows, today)`, in `src/lib/task-executions.ts` so the filter can be tested. Add a unit test for it.

## C. Occurrence identity and daily reset

- Identity stays as it is: task plus occurrence date, enforced by the existing unique index. `materialize_task_executions` inserts with "on conflict do nothing". Repeated or simultaneous fetches cannot create a second row.
- The next day's execution is created on its date by the existing materialize step that runs on every fetch. The midnight refetch triggers it, so it shows as Pending without a manual reload. Bogotá has no daylight-saving time, and every date goes through `agencyDate()` and SQL `America/Bogota`. Nothing relies on the browser's timezone.
- No new recurrence model. Placeholders are still used by the Executive views and are simply not shown in the creator list.

## D. Complete and Undo consistency

No change to the database actions. `task_execution_action` complete/reopen updates exactly one execution. Repeating it is harmless because the status is set, not toggled. The existing refresh of all task views covers the portal, Tasks, Daily Schedule and Overview. The button stays disabled while a request is in flight. If the response fails, the refetch shows the true saved state. The Completed section, strikethrough and Undo stay exactly as they are. Undo before or after midnight reopens that same date's execution, which then shows as overdue Pending if its date has passed.

## E. Risks

- **Trash, skip, edit, pause and restore:** unchanged. These are already filtered on the server, and this plan only hides the creator's future recurring copies.
- **Permissions:** unchanged. The server function only returns the creator's own shared executions.
- **Executive views and Overview:** untouched.
- **Data:** no data cleanup is needed. The two cancelled duplicates are already invisible. Nothing gets deleted.

## F. Focused verification

- **Unit test for `portalVisible`:** a daily task done today plus 14 future placeholders gives exactly 1 row. A future one-time task is kept. An overdue past recurring row is kept.
- **Existing integration tests** (no duplicate dates after repeated reads, complete today leaves tomorrow pending, creator sees only their own tasks) are re-run.
- **One browser pass as Executive:** Complete and Undo on "Airbnb" in Tasks, then Overview counts. The creator-session pass depends on whether a creator session can be created.

## G. Order

1. Add the helper and test.
2. Apply the filter, the progress fix and the midnight refetch in the portal.
3. Run the tests and check the build.
