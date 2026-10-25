# Time Blocks "Now", Real Overview Priorities, Legacy Section Removal

## A. Root causes (verified)

**1. "Now" indicator** — `tasks.tsx` already keeps one clock (`now`, refreshed every 30 s) and computes `currentBlock(now, blocks)` against the saved `task_time_blocks` in Bogotá time. Saving blocks invalidates the blocks query, so edits already flow through. Real gaps:
- 30 s tick means up to 30 s late at a boundary (e.g. 6:00 PM).
- `date` state is set once; after midnight the schedule stays on yesterday, so "Now" (which requires `date === agencyDate(now)`) disappears.
- Block end is exclusive ("Afternoon 15:00–18:00" ends at 17:59:59) — correct; a boundary of 17:59 vs 18:00 must be entered exactly as configured. No logic change needed there.

**2. Overview** — `dashboard.tsx` `StaffOverview` reads the legacy `tasks` table directly (`status <> done`, `archived_at is null`, `due_date`), not executions. So:
- Trashed series still count (1 open trashed task right now — `trashed_at` is not filtered).
- Recurring tasks count once using the series' old `due_date`/status, not today's execution; completing/skipping/trashing an execution doesn't change Overview.
- Overdue uses date-only `isOverdue`, not the Tasks rule (`executionOverdue`, date + time, Bogotá).

**3. Legacy sections** — Only UI remnants exist:
- `route.tsx` lines 45–48: "Soon" nav items Marketing, Chatting, Academy, VenusX Credits.
- `portal.tsx` line 214: "Academy, content submissions and messages are coming next."
- No Concierge or Zoom code, no tables, routes, functions, secrets or integrations for any of them (database checked: no matching tables). "zoom" hits are only animation class names in UI kit files — not related.

## B. Minimal implementation

1. `src/routes/_authenticated/tasks.tsx`
   - Tick aligned to the next minute boundary (setTimeout to next :00, then every 60 s) — one clock, same `currentBlock`.
   - If the user is viewing "today" and Bogotá date rolls over, advance `date` to the new day.
2. `src/routes/_authenticated/dashboard.tsx`
   - Replace the `tasks` query with the existing `task_agenda` RPC (today, Bogotá) plus the Overdue source already used by the Tasks Overdue tab (reuse the same query/RPC; no new one).
   - Open = executions not done/skipped/cancelled, not archived; overdue via `executionOverdue`; critical = open with priority critical; counted by execution id (no double counting). Permissions come from the RPC (Executive all, others own/published).
   - Query keys under `["tasks", ...]` so existing task mutations' invalidation refreshes Overview.
3. `src/routes/_authenticated/route.tsx` — delete the four legacy nav entries.
4. `src/routes/_authenticated/portal.tsx` — remove the "Academy…coming next" line.
5. `AGENTS.md` — note Overview derives from executions.

No migration, no new dependency.

## C. Legacy removal inventory

| Item | Where | Class |
|---|---|---|
| Marketing / Chatting / Academy / VenusX Credits nav | route.tsx | Safe to remove (UI only) |
| "Academy … coming next" text | portal.tsx | Safe to remove |
| Concierge, Zoom | none found | Nothing to remove |
| `marketing`, `chatting` work areas (enum, `AREA_LABEL`, Team & Access) | me.ts, team.tsx, `user_areas` | **Preserve** — these are employee job areas currently assigned to real members, not the retired sections |
| "zoom-in/out" CSS classes | components/ui | Unrelated animation, keep |

## D. Risks and safeguards
- Timezone: reuse `agencyDate`/`currentBlock` (Bogotá); no task dates/times touched.
- Midnight: only auto-advance when the viewer was on today; a manually chosen date stays.
- Overview permissions: RPCs are security-definer with the existing access rules; no RLS changes.
- Work areas kept so team access and permissions don't break.

## E. Focused verification
- Unit: `currentBlock` at 17:59 → Afternoon, 18:00 → Evening; custom block 22:00–02:00 at 00:30; next-minute delay helper.
- Browser (Executive): edit a block boundary → "Now" moves without refresh; Overview counts change after Complete, Undo, Move To Trash, Restore.
- Nav check for Executive (and creator view via code): no legacy entries; all routes load; existing tests pass.

## F. Order
1 nav/portal text removal → 2 clock fix + test → 3 Overview swap → run tests + one browser pass. No data cleanup required.
