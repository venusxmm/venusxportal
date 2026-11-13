# Fix Daily Schedule time ↔ block sync

## Cause
Each task occurrence can store a chosen block (set by drag & drop, the block menu or Grok). Once that is stored, it always wins over the hour. Changing the hour later (in the edit form, on the Board or via Grok) updates the hour but never clears the stored block, so the task stays in the old block. New tasks with no stored block already land in the block that matches their hour.

## Sync rule (last explicit action wins)
- Hour changed (and block not changed in the same action): clear the stored block, so the task is placed by its new hour using the current block ranges (for example 8:00 AM goes to Early Morning if that is the configured range).
- Block chosen by hand or by dragging: store that block, and keep the hour as it is. The hour does not pull it back.
- Hour removed: keep the current block. If there was no stored block, the task stays where it was shown, with no random reassignment.
- Manual order (position) and each block's Manual/Time/Priority mode are never touched by these rules.
- Runs once per save, so there are no loops or repeated moves. Old tasks are not reassigned in bulk.

## Technical details
- One small migration: a `BEFORE UPDATE` trigger on `task_executions`:
  if `due_time` changed and `block_id` did not change in the same update and the new `due_time` is not null, then set `block_id = NULL`.
  If `due_time` becomes null and `block_id` is null, set `block_id` to the block the old time fell in, so the task stays visibly in place.
- Because it is in the database, it covers every path at once: the edit form (`save_task_configuration`), Board/time moves (`move_task_execution`), and Grok tools. `place_task_execution` (drag/block menu) changes `block_id` itself, so it is left as is.
- No UI, design, permissions or MCP code changes. `effectiveBlock` in `src/lib/task-board.ts` stays the same.

## Verification
- Add a SQL check run inside a rolled-back transaction for scenarios 1, 2, 3, 5, 6 (create at 8:00, change hour, place in another block, change hour again, remove hour).
- Browser as Executive: drag between blocks, reload, edit the hour, reload; confirm block, position and sort mode persist.
- One Grok-equivalent call through the same database functions to confirm the same result.
- Run the existing task tests to confirm nothing else changed.
