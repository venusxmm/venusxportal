# Tasks: early completion and editing without "Cancelled"

## A. Verified root causes

**Bug 1: Complete is blocked until the task's date** (this is enforced in two places, so the screen alone is not the cause)
- My Portal sets `future = scheduled_date > today` and turns that into `disabled` on the Complete button.
- The database function `task_execution_action('complete')` refuses the action outright: `IF e.scheduled_date > today THEN RAISE 'Cannot complete future execution'`. Enabling the button alone would still fail.
- Tasks views also hide Complete for projected (not yet created) future dates. Those are recurring previews only, so this stays as it is.

**Bug 2: Editing marks the task as Cancelled**
- `save_task_configuration`, when editing, runs `UPDATE task_executions SET status='cancelled'` on every pending execution dated on or after the "effective" date (tomorrow, or the new start date). It logs `configuration_superseded`.
- For one-time tasks it then inserts a brand-new execution at that effective date. One edit therefore cancels the old row and creates a copy. If the old row was dated today or earlier, it stays and shows as Cancelled.
- Data: there are 5 active executions marked Cancelled, all on one-time tasks: "Completar Guía General…" (Oct 27), "QA RLS 2026-10-23 - edited", "Nicho de RF…", and "Raffaela" ×2. None of them are trashed.
- Cancelled is never chosen by a user. The only thing that creates it is this edit path. Other functions (agenda, portal, move, action) only filter it out. It is a legacy side effect, not a business workflow.

The two bugs share no helper. Both fixes belong in the same two database functions and the portal button.

## B. Minimal shared fix (all roles)
1. `task_execution_action`: remove the future-date rejection for `complete`. Keep the checks for permissions, trashed or archived executions, and purged occurrences.
2. `save_task_configuration` (editing an existing task):
   - **One-time task:** update its single pending, non-trashed execution in place: title, description, owner, linked creator, visibility, priority, time and date. A cleared deadline becomes no date (null), never an artificial date. Do not cancel it and do not insert a copy. Insert a new execution only if none exists. Done executions keep their status. Their content can be updated, but they are never reopened.
   - **Recurring task:** stop cancelling. Future pending executions that already exist are updated in place from the effective date onward, or archived as trashed occurrences only when the new pattern no longer includes that date. Past and done executions are untouched. Today's execution follows the existing "Also Update Today's" choice.
   - Log a `rescheduled` / `edited` event instead of `configuration_superseded`.
3. `portal.tsx`: remove `future` from the button's `disabled`. Tasks views use the same `canExecute`, which already allows owners and Executives. Projected previews stay non-actionable.

No new tables, columns or dependencies. One additive migration replaces the two functions.

## C. Semantics
- **Deadline** = when the task is due. It only affects the Pending/Overdue label, never whether it can be completed.
- **No deadline** = actionable, never automatically Overdue.
- **Completed / Skipped** = set only by an explicit action. **Trashed** = `archived_at` / `trashed_at`.
- **Cancelled** = no longer generated. The value stays in the database (the status is free text, not an enum constraint) so that history still reads correctly. The filters that exclude it stay.

## D. Data risks and cleanup (needs your approval)
- For each of the 5 Cancelled rows, I will first check whether its task already has another active execution (a copy made by the edit).
  - If a copy exists, the Cancelled row is a leftover. I will move it to Trash (reversible) rather than delete it.
  - If no copy exists, I will set it back to Pending, keeping its date and history. I will add an event noting the restore.
- No other records are rewritten. Any "QA" rows can be left as they are, or you can trash them yourself.

## E. Regression tests (integration, added to the existing suite)
1. Complete an execution dated 2 days ahead, as its owner and as a creator on a published task → done. A stranger → rejected.
2. Complete a task with no date → done.
3. Edit a pending one-time task: move the date earlier or later, or clear it → the same execution id, still todo, no Cancelled row, and the date is null when cleared.
4. Edit an Overdue task and clear its date → todo, not overdue.
5. Edit a done task → still done.
6. Edit the assignee and linked creator → preserved on the same row, and portal visibility rules are still enforced.
7. Recurring edit → past and done executions unchanged, future dates updated, no duplicates after repeated agenda reads.
8. Completing tomorrow's recurring execution early leaves the following day as todo.
9. Skip, trash, restore and purge behave the same as before.
10. Undo after an early completion → todo.
- Unit test: the portal Complete stays enabled for a future-dated execution and disabled for a projected one.

## F. One-pass order
1. Read the current full source of both functions once.
2. Write one migration with the two replaced functions.
3. Make the one-line portal change.
4. Add the tests and run the task test files.
5. Run the data check from D, then apply the cleanup.
6. Browser check as an Executive: edit a QA task to clear its date and confirm it does not show as Cancelled. Creator-side early completion is checked only through the database tests unless a creator session is available.

No publishing.

## Uncertainties
- Whether each of the 5 Cancelled rows has a copy is not yet checked (step 5).
- For a recurring edit that drops a weekday, the plan moves those future rows to Trash. If you'd rather they simply disappear, say so.
