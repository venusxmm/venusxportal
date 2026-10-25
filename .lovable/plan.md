# Final Tasks and Creator Portal fixes

## What changes

1. **Executive edit everywhere** — A pencil "Edit" button appears on task items in Daily Schedule, Overdue, List, Board, History and Manage, only for Executives. It opens the same full create/edit form already used in Manage and saves through the same existing executive-only configuration logic. That logic is already restricted to Executives on the server. Recurring edits keep applying only to future executions.
2. **Owner selection** — In New Task and Edit Task, a "Member type" field (All, Creator, Employee, Executive, Partner) comes before "Owner". It filters the owner list by role. When you open an existing task, its current owner stays selected even if the filter would hide it. "Unassigned" stays available. Linked Creator stays a separate field.
3. **Label rename** — "Visible In Creator VenusOS" becomes "Visible In Creator's Portal" everywhere it appears. The stored value does not change.
4. **Delete in Manage** — A trash button sits next to Edit on each task in Manage. A confirmation dialog clearly separates "Remove this execution" from "Stop the recurring series". Both use the existing safe archive actions, so no history is erased.
5. **View order** — Archive moves to the last tab. Nothing else about it changes.
6. **Creator tasks only in My Portal**
   - Creators no longer see Tasks in the navigation. Opening the Tasks page as a Creator sends them to My Portal.
   - "My tasks" in My Portal lists only executions the creator owns that an Executive marked visible in the Creator's Portal.
   - Each item shows the title, date, time (or "No time"), an expandable description and a Done/Undo button.
   - Tasks are sorted by date, then time. Untimed tasks come after the timed ones for the same date.
   - Completed tasks go into a collapsed "Completed" group.
   - Raw labels like "todo" are removed and replaced with readable status text.
   - Creators get no edit controls. The server already blocks them from changing task details.

## Verification
- Run the existing task tests and the isolated permission tests. Add one test that a Creator cannot see an owned task that is not published, and one that a Creator cannot change task configuration.
- Check in the browser as an Executive: Edit opens from each view, member-type filtering keeps the current owner, the delete dialog appears, and Archive is the last tab.
- Check the creator portal ordering and Done flow, with a creator account if one is available. If none is available, say so plainly.
- No publishing.

## Technical details
- Files: `src/routes/_authenticated/tasks.tsx` (shared `TaskForm` and `EditButton`, tab order, delete dialog, creator redirect), `src/routes/_authenticated/route.tsx` (hide Tasks nav for creator-only users), `src/routes/_authenticated/portal.tsx` (filter `visible_to_creator && owner_id === me.id`, sort, readable labels).
- Owner filter options come from `user_roles` joined with `profiles`. This needs Executive read access, which is already present.
- New database changes are expected to be unnecessary. If a backend check turns out to be missing, the fix will be one small, additive migration.
