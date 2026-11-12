# Daily Schedule: smooth ordering, sort modes, visible priority, MCP sync

## Root cause
- Dragging uses the browser's built-in HTML drag (`draggable` + onDragOver/onDrop in the Tasks screen). It does not work with touch on phones, has no auto-scroll, jumpy drop targets, and conflicts with click/scroll.
- Priority exists on every task/occurrence but the Daily Schedule card does not show it.
- There is no per-block sort mode; order is only manual position (`place_task_execution`).

## What changes
1. **Sort mode per block** (Manual / Time / Priority), small selector in each block header.
   - Time: tasks with an hour, earliest first; tasks without hour after, in manual order.
   - Priority: high > medium > low (existing values), ties keep manual order.
   - Dragging or using move controls in an auto block switches that block to Manual, keeping the order the user saw.
   - Saved per block (shared, Executive-controlled, same as block settings) so it persists after reload and matches Grok.
2. **Smooth drag & drop** with `@dnd-kit` (pointer + touch sensors, small press delay on touch so scrolling still works, auto-scroll, gold insertion line, drop into empty blocks). Grip handle only, so clicks on cards are unaffected. Card design unchanged.
3. **Quick controls** on each card (Executive): Up, Down, Move to block menu — same save call as drag.
4. **Priority on card**: colored pill (existing `Pill` style, black/white/gold) next to the time; tap to change High/Medium/Low (Executive), saved to that occurrence only — no series edit.
5. **Grok (MCP)**: 
   - `list_tasks` / `get_task` return block, position, priority, and block sort modes.
   - New `set_task_priority` (one occurrence).
   - New `set_block_sort_mode` and modes included in reads.
   - Existing move/reorder action unchanged (same RPC as UI). Hours never altered.

## Technical details
- One migration: `sort_mode text default 'manual' check in ('manual','time','priority')` on `task_time_blocks`; RPC `set_execution_priority(_execution_id, _priority)` (Executive or owner, same guards as place_task_execution, audit event). No data rewritten.
- Shared ordering helper in `src/lib/task-board.ts` (`orderBlock(rows, mode)`) used by UI and MCP; unit tests for the 3 modes + tie stability + auto→manual switch.
- Files: `src/routes/_authenticated/tasks.tsx`, `src/lib/task-board.ts`, `src/lib/mcp/tasks.ts`, `src/lib/mcp/tools/{list-tasks,get-task}.ts`, 2 new tool files, `src/lib/mcp/index.ts`. Add `@dnd-kit/core` + `@dnd-kit/sortable`.
- Re-extract MCP manifest.

## Verification
- Unit tests for ordering helper.
- Playwright as Executive at desktop (1280) and mobile (390, touch): reorder within block, move to another/empty block, Up/Down buttons, switch modes, change priority, reload and confirm persistence.
- MCP: manifest lists new tools; authenticated calls not possible from sandbox without Grok OAuth — will be reported as unverified if so.
- Publish needed for Grok to see changes.
