# Creator Portal: notifications, Spanish, deadline polish

## What the creator will see
- A bell icon in My Portal with a count of unread notifications. Opening it lists them (newest first); tap one to mark it read, or "Marcar todo como leído".
- Notifications for: new task assigned/published to her, important changes (title, date, time), task due tomorrow/today, and overdue tasks. Each one appears only once and only to that creator.
- All of My Portal in Spanish (navigation, buttons, states, progress, dates in Spanish format, notifications). The admin portal stays in English.
- Deadline line redesigned: a slim row under the title with a small colored dot plus full date and relative text ("Hoy", "Mañana", "Vence en 3 días", "Vencida hace 2 días"). Overdue cards get a thin red left accent instead of a large badge. Cleaner spacing between title, description, date and the Complete button; wraps cleanly on mobile.

## Technical details
- Reuse the existing `notifications` table (own-read/update RLS, unique `dedupe_key`). One migration adds:
  - A security-definer trigger on task configuration/execution changes that, when a task is published to a creator's portal, inserts a notification for the creator's linked account: `assigned:<task>`, and `changed:<task>:<revision/hash of date+time+title>` — `on conflict (dedupe_key) do nothing`.
  - A security-definer RPC `sync_my_due_notifications()` (caller's own published executions only, via existing portal helper) inserting `due:<exec>` and `overdue:<exec>` rows idempotently; called when My Portal loads. No cron, no external services.
- `src/components/portal.tsx`: bell + popover reading own notifications, mark-read updates (RLS-limited).
- `src/routes/_authenticated/portal.tsx`: Spanish strings, `es-CO` date formatting in America/Bogota, deadline row rework. Visual/text only; no task logic changes.
- No changes to Tasks, Daily Schedule, Board, MCP or permissions.

## Verification
- Build check; small test for the relative-deadline Spanish labels.
- Confirm in the database that a test-free read of trigger/RPC logic inserts nothing for non-published or other creators' tasks (rolled-back transaction).
- Browser not tested as a creator unless a creator session is available.
