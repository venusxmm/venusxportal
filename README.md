# VenusX Portal

VenusX Portal is a role-aware workspace for creator operations. The repository currently contains authenticated routes for:

- **Overview** — operational dashboard.
- **Creators** — creator profiles, status, internal notes and internal photos.
- **Tasks** — task scheduling, status, visibility and comments.
- **Finance** — a per-currency ledger, revenue splits, expenses and voiding.
- **Team & Access** — employee roles, work areas, invitations and membership access.
- **Audit Log** and **Settings**.
- **Creator portal** — the creator-facing task and account experience.
- **Authentication** — sign-in and password reset flows.

These are the implemented product surfaces, not a claim that every workflow has passed production acceptance testing. Marketing, Chatting, Academy, VenusX Credits and Consigliere are marked **Soon** in the application and are not described as implemented features. Whether those modules are formally excluded from a future V1 scope has not been established.

## Development

Use Bun to match the checked-in lockfile and release workflow:

```sh
bun install --frozen-lockfile
bun run dev
```

The browser application requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `VITE_SUPABASE_PROJECT_ID` may also be set for project-aware tooling. These are frontend configuration values; never put a service-role key or database password in a `VITE_` variable.

For schema migrations, Drizzle reads `LOVABLE_DB_MIGRATION_URL`. It is a privileged database credential: keep it out of source control and only point it at the explicitly verified target environment. The repository's checked-in `.env` is not a safe place for additional privileged credentials.

## Checks

```sh
bun run test
bunx tsc --noEmit
bun run lint
bunx prettier --check README.md .github/workflows/release.yml package.json src
bunx drizzle-kit check
bun run build
```

The migration/RLS integration tests use an isolated in-memory PostgreSQL engine and synthetic identities. They exercise SQL migration behavior and database-role policies, but do not replace tests through Supabase Auth, PostgREST, and Storage using authenticated sessions for each role.

`drizzle-kit check` validates migration journal structure. It does not connect to a database, prove a migration was applied, or validate the deployed RLS state.

## Database migrations and recovery

Migrations are in [`drizzle/migrations`](./drizzle/migrations). In particular:

- `0009_finance_hard_delete.sql` adds Executive-only hard deletion for ledger entries and audit logging.
- `0010_team_member_removal.sql` adds membership revocation/removal protections and updates access policies.
- `0011_creator_private_details.sql` moves internal creator notes and photo paths out of `creators`, then limits private-detail and task-comment reads to authorized staff.

Before applying migrations, identify the project from the connection target and inspect its migration journal. Do not assume a remote environment is staging, and do not blindly reapply `0009` or `0010`.

The configured Drizzle PostgreSQL migrator wraps its migration batch in a database transaction. `0011` also takes a table lock before copying and dropping the source columns; this prevents concurrent writes from being lost while the backfill runs. The migration was exercised against synthetic data in embedded PostgreSQL, including transaction rollback, repeat execution, and RLS checks.

`0011_creator_private_details.sql` was applied in the VenusX Lovable Cloud SQL Editor in a transaction. Before applying it, a read-only preflight confirmed that the required access helper functions existed and that `creators` had no rows or private values to backfill. Afterward, catalog queries confirmed that the private table has RLS enabled, the expected staff read and write policies and grants, the creator foreign key cascades on deletion, the legacy columns are gone, and the task-comment read policy enforces active staff access. The `creator-photos` bucket remains private with its four staff policies. These catalog checks do not prove authorization through real authenticated sessions.

The SQL Editor execution does not record the migration in Drizzle's `drizzle.__drizzle_migrations` ledger. The observed ledger contains only the initial migration entries, although later Cloud changes had already been applied. Do not run `drizzle-kit migrate` against this database until its ledger is reconciled with the full Cloud migration history; otherwise it may try to replay already-applied migrations.

There is no automatic down migration for `0011`. If it fails before commit, the migration transaction rolls back. After it commits, prefer a forward-fix. Restoring the database from a verified backup or point-in-time recovery is the recovery path for broader data loss. Do not copy private values back into `creators` without first changing the access boundary in the same controlled operation; column-level privacy is not enforced by row-level security.

The migration still needs verification through the actual Supabase/PostgREST API with authenticated Executive, Employee, and Creator sessions. The Cloud project currently has only an active Executive role; Lovable rejected a synthetic test account because its reserved email domain cannot receive email. No Employee or Creator account was created.

## Release status and known limitations

The UI version fallback is currently `0.1.0`. The release workflow validates a semantic-version tag and runs checks/builds, but it does not publish a deployment or deploy the application. A production release requires role-based authenticated API tests and a verified deployment/publishing procedure. No claim of V1.0.0 release readiness is made here.
