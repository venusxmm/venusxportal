# Remove Raffaela's stuck tasks and keep deleted tasks out of every creator portal

## What the data shows
- The two cards in Raffaela's portal, "Lee esto :)" and "Prueba" (both 2026-10-26, No time, Pending), were **never deleted**. Each one is a separate, still-active copy of a task.
- There were several copies of "Prueba". At 21:19 an Executive deleted one copy (the one already completed on Oct 25). That copy is in Trash and is already hidden from her portal. The other copy (pending on Oct 26) was never touched, so it still shows.
- A fourth "Prueba" exists with no owner. No portal can show it, but it is leftover clutter.
- Every task an Executive has deleted so far is already hidden from creator portals. The portal skips anything in Trash or permanently deleted.
- Aiko Sakai has her own "Leer esto :)" (pending Oct 26) that nobody deleted. It stays unless you say otherwise.

## Changes
1. **Clean up Raffaela's portal (one-time data fix):** permanently delete the duplicate "Lee esto :)" and "Prueba" copies, plus the ownerless "Prueba" and the copy already in Trash. Each one's executions, events and comments go with it, using the same permanent-delete action as Trash (with an audit record).
2. **Guarantee for every creator, now and later:** the portal shows a task only when the task itself is not in Trash and its date is not in Trash or permanently deleted. This rule is already in place. I will add an automated check that a creator can never get back any task or date an Executive deleted, for any creator, so this cannot break silently.
3. **Stale screen after deletion:** when an Executive deletes or restores anything, the app will also refresh the cached portal data, so a creator's open portal does not keep showing old cards.

## Not changed
Recurrence, Skip, Trash and Restore, permissions, Roadmap Progress and the other modules all stay as they are.

## Technical details
- Data: `purge_tasks` behaviour (events, then executions, then revisions, then comments, then tasks) for ids 728f78e8, 79ab76d2, 60ae3207 and d4911442, run through the data tool with an audit_events row. No migration.
- tasks.tsx: trash/restore/purge mutations invalidate `["tasks"]` (this already covers `["tasks","portal",…]`); confirm that every one of them does.
- Integration test: across all creators, `creator_portal_tasks` returns no row whose task has `trashed_at` set or whose execution has `archived_at`/`purged_at` set.
