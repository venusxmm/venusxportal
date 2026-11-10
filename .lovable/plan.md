# Tasks: manual order + MCP Trash/Restore/Reorder

## 1. Database (one migration)
- Add `sort_order integer` (nullable) to `task_executions`. Existing rows keep current time-based order as fallback.
- New RPC `reorder_task_executions(_ids uuid[])`: writes sort_order = array index; executive-only (or owner for own rows), guarded with existing helpers (`is_executive`, `can_read_execution`), logs to `audit_events`. Projected occurrences are first resolved via existing `task_resolve_execution`.
- Keep `due_time` optional; remove any uniqueness/conflict check on time in task save/move paths only if one exists (verify during implementation; no other schema changes).

## 2. Tasks UI (`src/routes/_authenticated/tasks.tsx`)
- Keep current card design, made compact ("mini card").
- Sort within each date/time block: `sort_order` first, then time, then title.
- Reuse the existing native drag handle: dropping on another card reorders (calls the RPC); dropping on a block keeps the current move behavior.
- Tasks without time show no clock line; tasks with time keep the gold highlighted time.
- Daily Schedule: untimed tasks can be placed and ordered inside blocks without being forced to pick an hour.

## 3. MCP (`src/lib/mcp/tools/`, registered in `index.ts`)
- `trash_task`: occurrence or series via existing `archive_task_executions` / `trash_task_series` RPCs; requires `confirm: true`; executive-only (enforced in DB).
- `list_trash`: read trashed occurrences/series the caller can see.
- `restore_task`: existing `restore_task_executions` / `restore_task_series`.
- `reorder_tasks`: date + ordered task ids → new RPC.
- No permanent delete via MCP. Same OAuth + RLS as current tools.

## 4. Verification
- Unit tests for sort comparator and the reorder rule.
- Manifest extraction; browser check: drag reorder, refresh persistence, trash/restore in UI.
- MCP calls with real token cannot be generated here; I will state that MCP write calls remain unverified until tried from Grok, then ask you to publish.

## Out of scope
Portal redesign, other modules, permanent purge via MCP.
