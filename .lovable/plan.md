# Finance + OnlyMonster integration (one pass)

## Findings already confirmed
- The key is saved as `ONLYMONSTER_API_KEY` (no spaces); only server code can read it.
- The scheduled-job helper the platform provides is already in the project, so automatic sync can be scheduled.
- API: `GET /api/v0/accounts`, `GET /api/v0/platforms/{platform}/accounts/{id}/transactions` and `.../chargebacks` (start/end range, cursor pagination, limit up to 1000, 15 req/s). Transactions return id, amount, fan, type, status and timestamp.

## What gets built
1. **Account mapping (Executives only):** a Finance "Connections" panel lists the real OnlyMonster accounts and lets an Executive link each one to an existing model (e.g. Rafaela) by hand. Nothing is linked automatically.
2. **Import:** for each linked account the server pulls transactions and chargebacks page by page. Each record is keyed by platform + account + OnlyMonster ID, so running it again updates the record instead of adding a duplicate. If the status changes or a chargeback arrives, the existing record is updated or voided. Manual entries are never touched, and each row shows a badge: "Imported · OnlyMonster" or "Manual".
3. **Sync:** a "Sync now" button (Executives only), plus an automatic sync every 30 minutes that re-checks the last 3 days so late status changes are caught. Each run records when it ran, whether it succeeded, how many rows it added or updated, and the error if it failed. On failure the data already saved stays as it is.
4. **Finance view:** period chips (Today by default in Bogotá time, rolling over at midnight; Yesterday; Last 7 days; This week; This month; Last month; Custom). A model filter (All or one model). Cards: Revenue generated, Creator share, VenusX share, Period expenses, Estimated VenusX result. All of them use the existing ledger math with each model's own split %. A transaction list shows model, date, amount, status and source. The panel also shows "Last sync" with the connection status.
5. **Amount definitions:** imported amounts count as gross generated revenue as OnlyMonster reports it, not cash received. Chargebacks void the matching revenue. Payout balances and payout requests are not booked as payouts. Expenses come only from the existing manual agency expenses, so nothing is counted twice.

## Technical details
- Migration (additive): `transactions` gets `source text default 'manual'`, `external_platform`, `external_account_id`, `external_status`, plus a unique index on (source, external_platform, external_account_id, external_ref). New tables `onlymonster_accounts` (account id, platform, name, `creator_id` nullable) and `integration_sync_runs`. All three are executive-only through RLS using `is_executive()`, with GRANTs. Existing rows default to manual and are not rewritten.
- `src/lib/onlymonster.server.ts`: the fetch client (with `x-om-auth-token`, retries on 429/502/504 with backoff, and cursor loop) and the upsert logic. Imported revenue rows take the model's existing agency share %. Statuses that aren't successful, and chargebacks, set `archived_at` (voided, never deleted).
- `src/lib/onlymonster.functions.ts`: `listOmAccounts`, `mapOmAccount`, `syncOnlyMonster`, `syncStatus`. Each uses `requireSupabaseAuth` and checks `is_executive` before loading the admin client.
- `src/routes/api/public/jobs/onlymonster-sync.ts` uses `authenticateCronRequest`. The managed HTTP schedule is set to `*/30 * * * *`.
- `finance.tsx`: period/model filters and source badges, plus the panel described above. Totals still come from `summarize()`.
- Tests: period range math in Bogotá, the dedupe key, status/chargeback mapping, and summarize per model with different splits.

## Verification (reported only if actually run)
- Real call to the accounts endpoint, Rafaela's account found and mapped, and a real import.
- A second sync adds 0 new rows.
- Totals match a raw sum from the API for the same window and statuses.
- Manual row count is unchanged.
- A non-Executive gets denied by both the database and the server function.
- Build and tests pass, and a scheduled run is logged.

## Possible blockers (reported as-is)
- The key might lack `dashboard.view` (shows up as a 403), or it might have no access to Rafaela's account.
- Webhooks are not configured.
