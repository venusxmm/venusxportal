# Fix: recurring future dates still not completable

## Root cause
Future recurring dates come from `task_agenda` as projected rows (no saved execution yet). The last fix removed one `!t.projected` check from the card, but the card also requires `canExecute(...)`, and `canExecute` in `src/lib/task-executions.ts` itself returns false for every projected row. So Complete stayed grey. The click path behind it is already correct: projected rows go to `task_future_action('complete')`, which creates or reuses that date's single execution (unique occurrence key) and completes only it.

## Change
- `src/lib/task-executions.ts`: remove `!task.projected &&` from `canExecute` (keep cancelled + owner/executive rules).
- Update the unit test that asserted projected = not executable (expect true for the owner, false for others).

My Portal intentionally lists recurring dates only up to today (earlier duplicate fix), so on a creator's own day it acts on a real execution. That stays as is.

## Checks
Run the task tests. As Executive in the browser: create a daily 6:00 AM task and a selected-weekdays task, open Oct 26, tap Complete on both, refresh to confirm they persist, check that Oct 27 is Pending with Complete enabled, then Undo on Oct 26.
