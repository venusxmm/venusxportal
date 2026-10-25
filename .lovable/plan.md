# Tasks: one lifecycle with Trash

## What the code and data show
- "Delete task / Stop series" only switches the recurring rule off (`recurrence_state = disabled`). The task's existing executions stay active, so they still show in the Creator's Portal and on their dates. Example: "Bloque #1 - Reddit" is disabled but its rows linger, and some one-time tasks have several active executions.
- "Delete Execution" archives one execution (`archived_at`). The task is never marked deleted, and nothing restores or permanently removes it.
- Archive labels rows "Already deleted". There is no Restore and no Delete Permanently.
- Manage and History are separate tabs. Their useful parts are the full edit form (also reachable from cards), the configuration list and the event history (stored in execution events and audit records).

## Lifecycle (one rule set)
```text
Rule (task)      active -> trashed (series) -> restored | purged
Execution        pending/overdue -> done/skipped (reversible)
                 any -> trashed (occurrence) -> restored | purged
```
- **Skip** affects one date and never removes or suppresses other dates.
- **Delete This Occurrence** trashes one execution. A trashed future occurrence is never regenerated.
- **Delete Entire Series** (and deleting a one-time task) marks the rule as trashed and stops future generation. It trashes the rule's active, not-done executions dated today or later. Completed past executions are kept for history and leave every view (except Trash context) while the series is trashed.
- **Restore occurrence** clears only that execution's trash flag.
- **Restore series** re-enables the rule and restores only the executions trashed by that series action. Missing future dates are generated normally. The existing unique-occurrence key prevents duplicates.
- **Delete Permanently** (Executive only, confirmed, with a count) removes the trashed execution, or the whole task, along with its executions, revisions, events and comments, in the right order. One audit event records it.
- All reads (Daily Schedule, Overdue, List, Board, task_agenda projection, creator_portal_tasks, Roadmap Progress) skip trashed rules and trashed executions.

## UI changes
- Tabs: Daily Schedule, Overdue, List, Board, Trash. Manage and History are removed. Their code is deleted rather than hidden. Edit (full form) stays on cards. A small "History" disclosure inside View Details keeps per-execution events.
- Every delete button (Daily Schedule, Overdue, List, Board) opens one dialog. Recurring tasks get "Delete This Occurrence" and "Delete Entire Series". One-time tasks get "Move To Trash".
- Trash lists items as "Occurrence · date" or "Entire series · recurrence", plus owner, deleted when and by whom. It has per-row and bulk Restore and Delete Permanently, filtered select-all and confirmations showing exact counts. The "Already deleted" label is removed.
- My Portal shows status labels Pending / Overdue / Completed / Skipped, View Details (description), Complete / Undo, in chronological order with "No time" last per date. Progress counts distinct non-trashed executions in the window. After a portal action, the portal and tasks queries are refreshed, and trashed rows are never rendered.

## Permissions
- All Trash, restore, purge and series actions are Executive-only, checked inside security-definer functions. Creators keep complete/reopen on their own published executions only. No access is widened.

## Technical details
- Migration 0032 (additive): `tasks.trashed_at`, `tasks.trashed_by`; `task_executions.trashed_by_series boolean default false`. New RPCs: `trash_task_series(_task_id)`, `restore_task_series(_task_id)`, `trash_task_executions(_ids, _confirm_count)`, `restore_task_executions(_ids, _confirm_count)`, `purge_task_executions(_ids, _confirm_count)` and `purge_tasks(_ids, _confirm_count)`, all Executive-only with an audit log. `materialize_task_executions`, `task_agenda`, `creator_portal_tasks`, `can_see_task` and `can_read_execution` exclude `tasks.trashed_at IS NOT NULL`. `archive_task_executions` drops its done-only restriction for occurrence trashing. Existing archived rows count as trashed occurrences. No columns are dropped. The Manage/History-only queries are removed from the client.
- Existing data: the disabled "Bloque #1 - Reddit" rule is left as-is (disabled, not trashed). It is reported so you can trash it from the new UI.
- Files: `tasks.tsx` (tabs, unified delete dialog, Trash view, removal of Manage/History), `portal.tsx` (status labels, details, progress), `task-executions.ts` (`portalStatus` helper).

## Tests (SQL integration + unit)
1. Publish to Raffaela -> visible in portal RPC -> trash series -> gone from portal and agenda.
2. Delete one occurrence -> neighbouring dates remain, nothing regenerated.
3. Trash series -> future dates are gone, the items are in Trash, past completed executions are kept.
4. Skip one date -> the next dates are still pending.
5. Restore occurrence/series -> portal visibility returns, with no duplicates after repeated agenda reads.
6. Purge -> rows are removed, with no orphan executions, events or comments.
7. Complete/reopen -> status, events and progress are correct; trashed items are excluded.
8. Non-executive calls to the trash, restore and purge functions are rejected; count mismatches are rejected.
9. Bulk actions touch only the selected ids.
- Browser check as Executive: the delete choices, Trash restore and purge on a QA task. The creator side is checked only if a creator session can be minted; otherwise it is reported as not checked. No publishing.
