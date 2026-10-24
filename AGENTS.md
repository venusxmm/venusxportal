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
- Team invitation email uses an authenticated executive-only server function to register through existing RPCs before native Auth sending; failed sends revoke only that new invitation. Why: preserve workspace authorization while avoiding unusable pending invitations and exposing no admin credentials.
- All ledger math goes through `src/lib/finance.ts` (`summarize`), per currency, in cents, excluding voided (`archived_at`) rows. Why: consistent, testable figures.
- Ledger entries are voided (archived), never deleted; `external_ref` is unique to block duplicate imports. Why: traceability.
- Automations insert with a unique `dedupe_key` + `on conflict do nothing` and log to `audit_events`. Why: idempotent retries.
- Creators change task status only via the `creator_set_task_status` RPC. Why: they must not edit other task fields.
- Modules not yet built appear in nav marked "Soon" and are non-clickable. Why: no dead or fake controls.
