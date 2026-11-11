# Daily Schedule: free drag & drop (block + position)

## Root cause (verified in code)
- Block membership is computed only from the task's time (`blockForTime(due_time)` in the Tasks screen). A task can't sit in a block unless its hour falls inside it.
- Dropping onto a block calls `move_task_execution` with the block's start time, so moving between blocks rewrites the task's hour.
- Reordering only works when dropping onto another card on the same day, never on future repeats not yet created, and there's no "drop at end / empty slot" position.
- Tasks with no time go to a separate "No Time" section and can't be placed in a block.

## What changes for you
- Drag any task up/down inside a block, or into any position of another block (Night ... Evening). The order and block are saved and survive reload.
- The hour stays untouched when you move a task. If it has one, it's shown in gold; it never decides order or block.
- Priority stays a visual label only.
- A gold line shows exactly where the task will land; empty blocks show "Drop Here".
- Grok gets one action to move a task to a block at a position, using the same save logic.
- Dates, deadlines, notifications, statuses, recurrence, Trash: unchanged.

## Technical details
1. Migration (additive, one column + one function):
   - `task_executions.block_id uuid null` referencing `task_time_blocks(id) on delete set null`.
   - Backfill: none needed. Effective block = `block_id`, else computed from time (current behavior), else first block. Existing order is preserved because `sort_order` already exists.
   - RPC `place_task_execution(_id, _task_id, _occurrence_date, _block_id, _before_id)`: same guards as `reorder_task_executions` (executive or owner, not trashed/purged); resolves projected recurring dates via existing `task_resolve_execution` (idempotent, no duplicates); sets `block_id`; renumbers `sort_order` for that date+block with the item inserted before `_before_id` (null = end); writes `audit_events`. Never touches `due_time`, dates or recurrence.
2. `src/lib/task-board.ts`: `effectiveBlock(exec, blocks)` shared helper; `compareExecutions` keeps sort_order-first.
3. `src/routes/_authenticated/tasks.tsx` (Daily Schedule only): group by `effectiveBlock`; fold "No Time" tasks into blocks; card/end-of-list drop targets call the new RPC; drop indicator line; block drop no longer calls `move_task_execution` (Move dialog for changing time/date stays).
4. MCP: add `place_task` tool (task id or task_id+date, block name/id, before task id or position) calling the same RPC; keep `reorder_tasks`. Re-extract manifest.
5. Note: project rule "blocks computed from time, never stored" is replaced by "block stored optionally on the execution, time is fallback" in AGENTS.md.

## Verification
- Unit test for `effectiveBlock` (stored block wins over time; no-time task falls back).
- DB integration test: place into other block keeps `due_time`; reorder within block; projected date resolves once.
- Browser as Executive: reorder within block, move between blocks, reload persists.
- MCP `place_task` call via server function, then confirm in UI.
