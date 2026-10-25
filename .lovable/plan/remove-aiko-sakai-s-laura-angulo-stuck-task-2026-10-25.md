# Remove Aiko Sakai's (Laura Angulo) stuck task

## What the data shows
- Aiko's "Leer esto :)" (Oct 26, Pending) is still an active task. Nobody has deleted it. As with Raffaela's, the Executive most likely deleted a different copy.
- I checked every creator. No task an Executive has deleted is still visible in any portal.

## Changes
1. Permanently delete Aiko's "Leer esto :)" along with its date, events and comments. An audit record is written, the same way as Raffaela's cleanup.
2. Check again across all creators that no deleted task remains visible. After that, the only tasks left in creators' portals are active ones that were never deleted.

## Not changed
Nothing else in Tasks, Trash or the portals changes. No other creator's active tasks are touched.

## Technical details
- Purge task d18ec202-ac0b-4bfd-867f-e8d919ea52b9: events, then executions, then revisions, then comments, then the task. Add an audit_events row. Run it as a data fix, with no migration.
