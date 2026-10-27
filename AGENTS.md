<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

# VenusX Portal rules

- Authorization lives in Postgres RLS + security-definer helpers (`is_executive`, `has_area`, `can_access_creator`, `can_see_task`, `is_own_creator`); UI hiding is cosmetic only. Why: one permission system, enforced server-side.
- Roles in `user_roles`, employee work areas in `user_areas`; never store privileges on profiles. Why: prevents privilege escalation.
- `creators` is the single creator record; every module links by `creator_id` instead of copying creator data. Why: one source of truth.
- Creator invitations pin `invitations.creator_id`; verification/login recovers pending acceptance through an authenticated RPC, never by client-selected workspace IDs. Why: persist the original workspace across devices without restoring revoked access.
- Auth email callbacks are public, validate provider identity, and return to sign-in after verification; the SDK processes implicit/PKCE links and token-hash links use verifyOtp. Why: keep verification separate from workspace navigation.
- Native invite callbacks require provider link validation before password setup; recovery requires its own link evidence, and link verification is shared across remounts. Why: ordinary sessions must not authorize recovery and single-use tokens must not be exchanged twice.
- All ledger math goes through `src/lib/finance.ts` (`summarize`), per currency, in cents, excluding voided (`archived_at`) rows. Why: consistent, testable figures.
- Ledger entries are voided (archived), never deleted; `external_ref` is unique to block duplicate imports. Why: traceability.
- Automations insert with a unique `dedupe_key` + `on conflict do nothing` and log to `audit_events`. Why: idempotent retries.
- Task configurations use executive-only revision RPCs; execution actions use owner/executive or explicitly published creator access, enforced by RLS. Executive movement changes one execution with an immutable occurrence key and schedule events; confirmed deletion archives executions without retiring recurrence. Why: dated snapshots, publication boundaries and append-only events preserve history without owner configuration edits or regenerated moved/deleted occurrences.
- Modules not yet built appear in nav marked "Soon" and are non-clickable. Why: no dead or fake controls.

- Team invitations: an executive-only server function registers one pending invitation per email, sends the native Auth invite (new identity) or a native sign-in link (existing identity, provider returns email_exists), and records delivery_status; failed sends stay pending for explicit resend/cancel. Why: honest delivery state without auto-revoking or duplicate identities.
- Removed/revoked access is never restored by profile edits, role grants, legacy recovery RPCs or invitations created before the removal; only accept_invitation for a new invitation (created after removal) by the matching verified identity clears the flags, replacing old roles/areas with the invitation's. Why: explicit re-grant only, stale links stay dead.- Creator portal publication requires owner = linked creator's own account (enforced in save_task_configuration and read helpers); portal reads use creator_portal_tasks over a date range. Why: owner and portal visibility can never disagree.
- Time blocks live in task_time_blocks (executive-write RLS) and are computed from execution time, never stored on tasks; blocks may wrap midnight but must not overlap. Why: block edits regroup without touching schedules or history.
- Task deletion is one Trash lifecycle: occurrences use executions.archived_at, series use tasks.trashed_at (all reads exclude both); restore/purge are executive-only RPCs, and purged occurrences of live recurring rules keep a contentless tombstone (purged_at). Why: reversible deletes that never regenerate or leak to portals.
- Overview task counts derive from task_agenda executions (same source as Tasks), never the tasks table. Why: trashed/completed/recurring state stays consistent.
- Task edits update existing executions in place (one-time: same row, cleared date = null; recurring: future pending rows, dropped dates trashed); edits never cancel or reopen, and completion is allowed before the scheduled date. Why: deadlines mark due dates, not eligibility.
- OnlyMonster import: server-only sync (src/lib/onlymonster.server.ts) upserts revenue rows keyed by source+platform+account+external_ref, voids (archived_at) undo/chargeback rows, never touches manual rows; accounts map to creators explicitly with their own agency %; scheduled via managed HTTP schedule to /api/public/jobs/onlymonster-sync. Why: idempotent, auditable imports with per-contract splits.
