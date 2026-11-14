# Finances and Task History Repair

## 1. Finances looks empty while Dashboard shows money

**Confirmed cause (expected behavior, not lost data):**
- The database has exactly 1 active entry: a manual revenue of USD 620.00 dated 2026-11-04. Nothing is voided or missing. (The 172 OnlyMonster entries were deleted on purpose in the previous step.)
- The Dashboard adds up the **current month** (from Nov 1), so it shows the USD 620.
- Finances opens on the **"Today"** period (Nov 13 in Bogota), so the Nov 4 entry is filtered out and the list looks empty.
- Both screens read the same records and use the same calculation. No query, permission or saving error was found.

**Smallest fix:** open Finances on **"This month"** by default, the same window the Dashboard uses. The other period options stay as they are. No change to amounts, records or the database.

## 2. Task "Comments & History" is too long

**Confirmed:** View Details lists every event, oldest first, with no limit and no author. One task can have dozens of "Edited" and "Rescheduled" lines (290 edits and 232 reschedules across 54 tasks). No exact duplicates were found within the same second. The likely double entry is that one edit can save both an "Edited" and a "Rescheduled" line; I'll check this before merging anything.

**Smallest fix (display only, nothing deleted):**
- Newest first; show the latest 5, with a "Show full history (N)" button that expands the full list.
- Three clear kinds: **Comment** (human text), **Edit**, **Reschedule/Status** (complete, reopen, skip, trash), each with its own small label in the current gold/black style.
- Show the author's name next to the date.
- If "Edited" and "Rescheduled" come from the same action (same person, within a few seconds), show them on one line. Both records stay saved.
- Description, priority and the Complete/Reopen and skip actions stay above the history, unchanged.

## 3. What stays untouched
Daily Schedule blocks, automatic block by time, drag & drop, the Manual/Time/Priority modes, optional times, statuses, priorities, dates, Board, Trash and the Grok actions. No database changes.

## Technical details
- `src/routes/_authenticated/finance.tsx`: change the default value of `useState<Period>("today")` to the existing month period key.
- `src/routes/_authenticated/tasks.tsx` (execution detail dialog, ~L1079–1180): order events descending, use a `showAll` state, put events into a `kind` group by `action`, merge `edited`+`rescheduled` pairs from the same `actor_id` within 5 seconds, and resolve `actor_id` names through the profiles query the page already loads.
- Tests: add a small unit test for the grouping/merge helper (a merged pair, a comment kept as is, order newest first). Re-run the existing task and finance tests.

## Verification
- Browser: Finances opens on this month and shows the USD 620 entry, matching the Dashboard. Then create one entry, edit it, and reload to confirm it persists.
- Open View Details on a task with long history: 5 recent items are shown, they expand to the full list, and the authors are visible.
- Drag a task once and reload to confirm Daily Schedule still works.

## Budget
About 1–2 credits: two small files and one helper test.
