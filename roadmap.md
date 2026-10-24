# V1 stabilization

## Current targeted connection repair
- [ ] Trace invitation middleware environment failure and restore the existing runtime binding.
- [ ] Verify authenticated Team & Access backend reachability without sending email or changing members.
- [ ] Run focused invitation, revocation/removal and password-reset checks; report real-email blockers.

## Explicit access recovery removal
- [x] Remove recovery section, removed-member category, handlers, state and obsolete copy controls.
- [x] Disable legacy recovery creation and acceptance; prevent profile/role-based restoration without deleting business data.
- [x] Run focused isolated revocation, membership-removal, invitation and password-reset checks (24 passed); no real-member mutations, emails or deployment.

## Focused native Auth invitation repair
- [x] Connect Team & Access to executive-authorized native invitation email with fixed Vercel callback; no schema change.
- [x] Add native invite link handling, shared verification and password setup returning to login.
- [x] Reject ordinary recovery visits; validate recovery link before showing the form.
- [x] Run focused tests and public browser checks; compare public Vercel bundles.
- [ ] Verify full native invitation and password login: blocked by unavailable controlled QA mailbox and authenticated executive test session; native sender is now connected in code, not yet proven by a real send.
- [ ] Verify production repair: blocked by required authorized Vercel deployment; no deployment performed.

## Current scope: Creator invitation repair
- [ ] Inspect live invitation functions, auth settings, routes and migration history.
- [ ] Bind invitations to existing creators and recover verified pending access safely.
- [ ] Repair signup, confirmation callback, sign-in and controlled error states.
- [ ] Run isolated integration, UI and security checks; document precise limitations.

- [ ] Audit live schema, migration history, authorization and deployment.
- [ ] Fix chronological task ordering, schedule completion and time-block/mobile layout; test.
- [ ] Fix invitation clipboard handling and acceptance; verify email prerequisites.
- [ ] Fix safe expense removal and creator-specific transactional payouts; test.
- [ ] Verify OnlyMonster documentation/access; preserve manual revenue entry.
- [ ] Run automated tests, lint, real-session and mobile checks; inspect build signals.
- [ ] Document Vercel requirements, exact blockers and deployment evidence.
