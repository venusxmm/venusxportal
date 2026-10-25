# Tasks: recurrence, creator visibility and Archive fixes

## What the real data shows (read before planning)

- There are **two separate tasks** named "Bloque #1 - Reddit":
  - Task A: daily, owner Ángel's teammate (owner set), executions: Oct 27 = Skipped (approved), plus one archived undated row.
  - Task B: daily, **Unassigned**, created minutes later, one execution on Oct 25.
  Because Task B is unassigned, only Executives see it. On every date the Executive sees one or two "Bloque #1" cards depending on which task has an execution or projection there. That alone explains "disappears on some dates, reappears on others".
- The only stored skip is on **Oct 27**, not Oct 26. The cause is unconfirmed. Either the skip was sent from the Oct 27 view, or the date was resolved wrongly. The first build step reproduces this before changing anything.
- Date math (`agencyDate`, `shiftDate`) is timezone-safe. Duplicate protection already exists: one active execution per task per original date.
- 5 tasks are published to a Creator's Portal. 1 of them has an Owner who is not the linked Creator, and 5 tasks overall have an Owner that does not match the Linked Creator.

## Root causes

1. **Skip shows as pending/blocked.** A Skip request stays "Skip requested" (pending) until an Executive approves it. The card still shows Pending. There is no clear Skipped label, and approved skips move into the day's "Completed" group, so it looks like the task vanished.
2. **Delete Execution on skipped items.** The button exists for stored executions. Future dates that were never acted on are only "projected", so they have no Delete. The rule is inconsistent and unexplained.
3. **Duplicate-named twin task** (data, not logic). It makes the schedule look inconsistent across dates.
4. **Creator portal misses tasks.** My Portal asks for **today's agenda only**, so published tasks on other dates never appear. It also filters by `owner_id = creator`, while database access is granted by **Linked Creator + published**. Those two rules disagree.
5. **Owner/Linked Creator contradictions.** The form and the save function accept any combination, e.g. Owner Laura with Linked Creator Raffaela, published.
6. **Archive checkboxes.** A checkbox only renders for status Done. Skipped and other non-done archived rows get none and no reason. "Select all" is missing.

## Rules to apply

**Executions (each date is independent)**
- Complete, Reopen, Skip and Delete act on one execution, identified by task + original date. They never touch the recurring rule.
- Acting on a future, not-yet-stored date first creates that single execution (this already exists) and then applies the action. Delete is offered too: a stored, archived execution stops that one date from being regenerated.
- Skip shows a clear state: "Skip Requested" (awaiting Executive), "Skipped" (approved) or back to Pending (rejected). Skipped items stay on their own date in a "Done / Skipped" group.
- Recurrence edits stay a separate "Edit" action and apply from tomorrow only, as today.

**Owner / Linked Creator / Portal**
- Owner = who does the task.
- Linked Creator = which creator the task is about. Only creators are listed.
- If the Owner is a Creator, Linked Creator is set to that same creator and locked (it stays in sync).
- If the Owner is anyone else or Unassigned, Linked Creator is optional but **"Visible In Creator's Portal" is disabled**. Publishing is only allowed when Owner = Linked Creator's own account.
- The database save function enforces the same rule, so the screen cannot be bypassed.
- My Portal shows only executions where the linked creator is the signed-in creator's own record, the task is published and the owner is that creator. Server access is narrowed to match (no widening).

**Existing mismatched records (no silent reassignment)**
- Nothing is reassigned automatically.
- Published tasks whose Owner is not the creator stop appearing in any portal. This is the safe direction: nothing becomes more exposed.
- Manage shows a "Needs review" badge on mismatched tasks. Executives fix them by editing.
- The twin "Bloque #1" task is left untouched and listed in the report for you to merge or delete.

**Creator My Portal**
- Shows published executions from 7 days back to 14 days ahead, plus overdue ones. Today's are not the only ones shown.
- Sorted by date, then time. "No time" items come last for each date.
- Recurring items carry a "Daily" or "Weekdays: Mon, Wed" label. Done completes only that date's execution. Future items are view-only until their day.

**Archive**
- A checkbox appears on every archived row. Done rows are selectable. Other rows show a disabled checkbox with the reason "Only completed executions can be deleted", matching the server rule.
- "Select all" selects every eligible row in the current filter. All rows are loaded already, with no paging.
- Both delete buttons show the exact count and require confirmation. The existing safe archive action is reused and never touches recurring rules.

**Permissions** stay unchanged: Executives manage everything. Others see only their own and their own published tasks. Only Executives can change task configuration (this stays the existing product rule; the plan adds no task creation for other roles).

## Technical details

- Migration 0030 (additive, no data changes):
  - `save_task_configuration`: reject publishing unless `owner_id` = the linked creator's `creators.user_id`, and reject `creator_id` when the owner is a creator of a different record.
  - `can_read_execution` / `can_see_task` / `task_agenda` projection: published access requires `owner_id = auth.uid()` as well as `is_own_creator(creator_id)`.
  - New `creator_portal_tasks(_from date, _to date)` RPC: stored and projected executions in a date range, using the same access check.
  - `task_future_action`: also allow `'archive'` so a future date can be deleted individually.
- `src/routes/_authenticated/tasks.tsx`: TaskForm sync/lock logic, skip state labels, a "Done / Skipped" group, Delete on projected executions, Archive checkbox/reason/select-all, "Needs review" badge.
- `src/routes/_authenticated/portal.tsx`: use the range RPC, recurrence label, keep Done/Undo.
- `src/lib/task-executions.ts`: `recurrenceLabel`, `ownerCreatorConsistent` helpers.

## Tests

- SQL (`task-executions.integration.test.ts`):
  - Skipping Oct 26 leaves Oct 25/27/28 todo and keeps the recurring rule enabled.
  - Deleting one future date leaves the neighbouring dates.
  - No duplicates after repeated agenda reads.
  - Completing today leaves tomorrow todo.
  - Publishing with an owner that is not the linked creator is rejected.
  - A creator cannot see another creator's or an unpublished task.
  - The portal range returns a published future date.
  - Non-executives cannot archive in bulk.
- Unit: owner/creator consistency, recurrence label, portal sort with "No time" last per date.
- Browser as Executive: skip → Skipped label, neighbouring dates intact, Delete visible, Archive select-all count. The creator portal will be browser-checked only if a creator session is available; otherwise it is reported as not checked.
- No publishing or deployment.

## Addendum: task times and time blocks

### What the data shows
- The task settings store times exactly. For example, "Airbnb" is saved at 15:00 and several tasks at 16:00. No timezone shift was found in how the time is entered or stored.
- The day's execution can still show a different time. Examples from today: "Raffaela" task 16:00 vs today 15:05, "Nicho de RF" 16:00 vs 15:10, "Preparación de Guía" 12:00 vs 18:00.
- Root cause: editing a task applies **from tomorrow** to protect today's history, so today's card keeps the old or moved time. That looks like the time "did not save".
- Time blocks are hard-coded today (Night 00–04 … Evening 18–24). No Edit Time Blocks control or saved block customization exists in the current code, so there is nothing to restore. Block management will be built new, with the current six blocks as defaults.

### Changes
- **Time edits:** when an Executive changes only the time (or other details) of a task with a pending execution today, the form asks: "Also update today's execution?" (default Yes). Yes updates only today's not-yet-completed execution and logs a "rescheduled" event. Completed and past executions are never changed. Recurrence still applies from tomorrow.
- **One time format everywhere:** 12-hour display ("3:00 PM") in Daily Schedule, Board, List, Overdue, History, Manage, details and My Portal, from the same stored 24-hour Bogotá value.
- **Automatic blocks:** the block is always computed from the execution's time against the configured boundaries. It is never stored on the task, so changing a time or a boundary regroups everywhere without touching dates, times, recurrence or history. Blocks that cross midnight (e.g. 22:00–02:00) are supported.
- **Edit Time Blocks (Executives):** a small button on the Tasks page opens a dialog to rename blocks, change start/end times, add, remove and reset to defaults. Saving is blocked when blocks overlap, have no length or have the same name, so every time maps to exactly one block. Times that fall outside every block go into an "Unscheduled hours" group. Everyone sees the same blocks; only Executives can change them, and the database enforces it.

### Technical details (addendum)
- Migration 0030 adds `task_time_blocks` (id, label, start_time, end_time, position). It includes GRANTs and RLS: active members can read, only Executives can write. The six current blocks are inserted as defaults in the same migration.
- `save_task_configuration` gets an optional `apply_today` flag that updates today's non-done, non-archived execution and writes a `rescheduled` event.
- `src/lib/task-board.ts`: `blockForTime(time, blocks)` handles midnight wrap, `validateBlocks`, `formatTime12`. Blocks are loaded into the board, the Move dialog and drag targets.
- Tests: 03:30 lands in Night. 22:00–02:00 matches 01:00 and 23:00. Overlapping blocks are rejected. The 15:00/16:00 round trip is checked. Editing the time with `apply_today` updates today only and leaves completed executions untouched. Non-executives cannot change blocks.
