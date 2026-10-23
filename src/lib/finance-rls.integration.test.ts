// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarize } from "./finance";

const deleteMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0009_finance_hard_delete.sql"),
  "utf8",
);
const payoutBalanceMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0013_creator_payout_balance.sql"),
  "utf8",
);
const archiveOnlyMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0014_transactions_archive_only.sql"),
  "utf8",
);
const postCreatorPayoutMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0015_post_creator_payout.sql"),
  "utf8",
);
const expenseAgencyCutAndDeleteMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0016_expense_agency_cut_and_delete.sql"),
  "utf8",
);
const expenseReferenceReuseMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0017_expense_reference_reuse.sql"),
  "utf8",
);
const deleteAllTransactionsMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0018_delete_all_transactions.sql"),
  "utf8",
);
const ids = {
  executive: "00000000-0000-0000-0000-000000000001",
  employee: "00000000-0000-0000-0000-000000000002",
  creator: "00000000-0000-0000-0000-000000000003",
  creatorAccount: "00000000-0000-0000-0000-000000000101",
  sharedEntry: "00000000-0000-0000-0000-000000000201",
  privateEntry: "00000000-0000-0000-0000-000000000202",
};

let db: PGlite;

async function asUser<T>(userId: string, query: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${userId}', true); set local role authenticated;`,
  );
  try {
    const result = await query();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  } finally {
    await db.exec("reset role");
  }
}

describe("finance row-level security integration", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role authenticated nologin;
      create role anon nologin;
      create schema auth;
      create type public.app_role as enum ('executive', 'employee', 'creator');
      create type public.txn_kind as enum ('revenue', 'expense', 'payout');
      create table public.profiles (
        id uuid primary key,
        membership_removed_at timestamptz,
        access_revoked_at timestamptz
      );
      create table public.user_roles (user_id uuid not null, role public.app_role not null);
      create table public.creators (
        id uuid primary key,
        user_id uuid,
        archived_at timestamptz
      );
      create table public.audit_events (
        id uuid primary key default gen_random_uuid(),
        actor_id uuid,
        entity text not null,
        entity_id uuid,
        action text not null,
        details jsonb
      );
      create table public.transactions (
        id uuid primary key default gen_random_uuid(),
        kind public.txn_kind not null,
        amount numeric(14, 2) not null check (amount > 0),
        currency char(3) not null default 'USD',
        occurred_on date not null default current_date,
        category text not null default 'general',
        description text,
        creator_id uuid references public.creators(id),
        agency_share_pct numeric check (agency_share_pct between 0 and 100),
        external_ref text unique,
        shared_with_creator boolean not null default false,
        archived_at timestamptz,
        created_by uuid
      );
      grant usage on schema public, auth to authenticated;
      grant execute on all functions in schema auth to authenticated;
      grant select, insert, update, delete on public.transactions to authenticated;
      alter table public.transactions enable row level security;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant execute on function auth.uid() to authenticated;
      create function public.is_active_member(_user_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from public.profiles where id = _user_id
            and membership_removed_at is null and access_revoked_at is null
        )
      $$;
      create function public.has_role(_user_id uuid, _role public.app_role) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.is_active_member(_user_id)
          and exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
      $$;
      create function public.is_executive() returns boolean
      language sql stable security definer set search_path = public as $$
        select public.has_role(auth.uid(), 'executive')
      $$;
      create function public.is_own_creator(_creator_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select exists (
          select 1 from public.creators where id = _creator_id and user_id = auth.uid()
        )
      $$;
      create policy "txn exec read" on public.transactions for select to authenticated
        using (
          public.is_executive()
          or (shared_with_creator and creator_id is not null and public.is_own_creator(creator_id))
        );
      create policy "txn exec insert" on public.transactions for insert to authenticated
        with check (public.is_executive());
      create policy "txn exec update" on public.transactions for update to authenticated
        using (public.is_executive());
      create function public.audit_row() returns trigger language plpgsql
      security definer set search_path = public as $$
      begin
        insert into public.audit_events (actor_id, entity, entity_id, action)
        values (
          auth.uid(),
          tg_table_name,
          case when tg_op = 'DELETE' then old.id else new.id end,
          lower(tg_op)
        );
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end $$;
      grant execute on all functions in schema public to authenticated;
      insert into public.profiles (id) values
        ('${ids.executive}'), ('${ids.employee}'), ('${ids.creator}');
      insert into public.user_roles (user_id, role) values
        ('${ids.executive}', 'executive'), ('${ids.employee}', 'employee'), ('${ids.creator}', 'creator');
      insert into public.creators (id, user_id)
        values ('${ids.creatorAccount}', '${ids.creator}');
      insert into public.transactions
        (id, kind, amount, category, creator_id, agency_share_pct, shared_with_creator)
        values
          ('${ids.sharedEntry}', 'revenue', 50, 'shared', '${ids.creatorAccount}', 60, true),
          ('${ids.privateEntry}', 'expense', 20, 'private', '${ids.creatorAccount}', null, false);
    `);
    await db.exec(deleteMigration);
    await db.exec(payoutBalanceMigration);
    await db.exec(payoutBalanceMigration);
    await db.exec(archiveOnlyMigration);
    await db.exec(archiveOnlyMigration);
    await db.exec(postCreatorPayoutMigration);
    await db.exec(postCreatorPayoutMigration);
    await db.exec(expenseAgencyCutAndDeleteMigration);
    await db.exec(expenseAgencyCutAndDeleteMigration);
    await db.exec(expenseReferenceReuseMigration);
    await db.exec(expenseReferenceReuseMigration);
    await db.exec(deleteAllTransactionsMigration);
    await db.exec(deleteAllTransactionsMigration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("allows an executive to create, void, restore, and safely delete an expense", async () => {
    const { rows } = await asUser(ids.executive, () =>
      db.query<{ id: string }>(
        "insert into public.transactions (kind, amount, category) values ('expense', 12.50, 'QA expense') returning id",
      ),
    );
    const entryId = rows[0]?.id;
    expect(entryId).toBeTruthy();

    const voided = await asUser(ids.executive, () =>
      db.query<{ archived_at: string | null }>(
        "update public.transactions set archived_at = now() where id = $1 returning archived_at",
        [entryId],
      ),
    );
    expect(voided.rows[0]?.archived_at).not.toBeNull();

    const restored = await asUser(ids.executive, () =>
      db.query<{ archived_at: string | null }>(
        "update public.transactions set archived_at = null where id = $1 returning archived_at",
        [entryId],
      ),
    );
    expect(restored.rows[0]?.archived_at).toBeNull();

    await expect(
      asUser(ids.executive, () =>
        db.query("delete from public.transactions where id = $1 returning id", [entryId]),
      ),
    ).rejects.toThrow(/permission denied/i);

    const { rows: deleted } = await asUser(ids.executive, () =>
      db.query<{ delete_expense: string }>("select public.delete_expense($1)", [entryId]),
    );
    expect(deleted[0]?.delete_expense).toBe(entryId);
    const { rows: remaining } = await db.query("select id from public.transactions where id = $1", [
      entryId,
    ]);
    expect(remaining).toHaveLength(0);

    const { rows: auditRows } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.audit_events where entity_id = $1 and action in ('insert', 'update', 'delete')",
      [entryId],
    );
    expect(Number(auditRows[0]?.count)).toBe(4);
  });

  it("denies an employee permission to create, change, or delete ledger entries", async () => {
    await expect(
      asUser(ids.employee, () =>
        db.query(
          "insert into public.transactions (kind, amount, category) values ('expense', 1, 'unauthorized')",
        ),
      ),
    ).rejects.toThrow(/row-level security policy/i);

    const updated = await asUser(ids.employee, () =>
      db.query("update public.transactions set archived_at = now() where id = $1 returning id", [
        ids.privateEntry,
      ]),
    );
    expect(updated.rows).toHaveLength(0);
    await expect(
      asUser(ids.employee, () =>
        db.query("delete from public.transactions where id = $1 returning id", [ids.privateEntry]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(ids.employee, () => db.query("select public.delete_expense($1)", [ids.privateEntry])),
    ).rejects.toThrow(/only executives/i);
  });

  it("restricts permanent deletion to expenses without granting direct DELETE", async () => {
    const { rows: privileges } = await db.query<{
      authenticated_can_execute: boolean;
      anon_can_execute: boolean;
      authenticated_can_delete: boolean;
    }>(`select
      has_function_privilege('authenticated', 'public.delete_expense(uuid)', 'EXECUTE')
        as authenticated_can_execute,
      has_function_privilege('anon', 'public.delete_expense(uuid)', 'EXECUTE')
        as anon_can_execute,
      has_table_privilege('authenticated', 'public.transactions', 'DELETE')
        as authenticated_can_delete`);
    expect(privileges[0]).toEqual({
      authenticated_can_execute: true,
      anon_can_execute: false,
      authenticated_can_delete: false,
    });

    await expect(
      asUser(ids.executive, () => db.query("select public.delete_expense($1)", [ids.sharedEntry])),
    ).rejects.toThrow(/expense not found/i);
    const { rows } = await db.query("select id from public.transactions where id = $1", [
      ids.sharedEntry,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("allows executives to physically delete each transaction kind while preserving audit", async () => {
    const transactionIds = {
      expense: "00000000-0000-0000-0000-000000000401",
      revenue: "00000000-0000-0000-0000-000000000402",
      payout: "00000000-0000-0000-0000-000000000403",
    };
    const { rows: privileges } = await db.query<{
      authenticated_can_execute: boolean;
      anon_can_execute: boolean;
      authenticated_can_delete: boolean;
    }>(`select
      has_function_privilege('authenticated', 'public.delete_transaction(uuid)', 'EXECUTE')
        as authenticated_can_execute,
      has_function_privilege('anon', 'public.delete_transaction(uuid)', 'EXECUTE')
        as anon_can_execute,
      has_table_privilege('authenticated', 'public.transactions', 'DELETE')
        as authenticated_can_delete`);
    expect(privileges[0]).toEqual({
      authenticated_can_execute: true,
      anon_can_execute: false,
      authenticated_can_delete: false,
    });

    await asUser(ids.executive, () =>
      db.query(
        `insert into public.transactions (id, kind, amount, category, creator_id)
        values
          ($1, 'expense', 5, 'synthetic expense', null),
          ($2, 'revenue', 50, 'synthetic revenue', null),
          ($3, 'payout', 2, 'synthetic payout', $4)`,
        [transactionIds.expense, transactionIds.revenue, transactionIds.payout, ids.creatorAccount],
      ),
    );

    await expect(
      asUser(ids.employee, () =>
        db.query("select public.delete_transaction($1)", [transactionIds.expense]),
      ),
    ).rejects.toThrow(/only executives/i);

    for (const id of Object.values(transactionIds)) {
      const { rows } = await asUser(ids.executive, () =>
        db.query<{ delete_transaction: string }>("select public.delete_transaction($1)", [id]),
      );
      expect(rows[0]?.delete_transaction).toBe(id);
    }

    const { rows: remaining } = await db.query(
      "select id from public.transactions where id = any($1::uuid[])",
      [Object.values(transactionIds)],
    );
    expect(remaining).toHaveLength(0);

    const { rows: auditRows } = await db.query<{ entity_id: string; action: string }>(
      "select entity_id, action from public.audit_events where entity_id = any($1::uuid[]) order by entity_id, action",
      [Object.values(transactionIds)],
    );
    expect(auditRows).toHaveLength(6);
    expect(auditRows.filter((row) => row.action === "insert")).toHaveLength(3);
    expect(auditRows.filter((row) => row.action === "delete")).toHaveLength(3);
  });

  it("prevents deleting revenue when it would invalidate an existing payout", async () => {
    const revenueId = "00000000-0000-0000-0000-000000000411";
    const payoutId = "00000000-0000-0000-0000-000000000412";
    await asUser(ids.executive, () =>
      db.query(
        `insert into public.transactions
          (id, kind, amount, category, creator_id, agency_share_pct)
        values ($1, 'revenue', 10, 'synthetic revenue backing payout', $2, 60)`,
        [revenueId, ids.creatorAccount],
      ),
    );
    await asUser(ids.executive, () =>
      db.query(
        `insert into public.transactions (id, kind, amount, category, creator_id)
        values ($1, 'payout', 24, 'synthetic settled payout', $2)`,
        [payoutId, ids.creatorAccount],
      ),
    );

    await expect(
      asUser(ids.executive, () => db.query("select public.delete_transaction($1)", [revenueId])),
    ).rejects.toThrow(/earned balance below zero/i);
    const { rows: preservedRevenue } = await db.query(
      "select id from public.transactions where id = $1",
      [revenueId],
    );
    expect(preservedRevenue).toHaveLength(1);

    await asUser(ids.executive, () => db.query("select public.delete_transaction($1)", [payoutId]));
    await expect(
      asUser(ids.executive, () => db.query("select public.delete_transaction($1)", [revenueId])),
    ).resolves.toBeDefined();
  });

  it("persists the expense deduction option and defaults legacy rows to enabled", async () => {
    const { rows: legacy } = await db.query<{ deduct_from_agency_cut: boolean }>(
      "select deduct_from_agency_cut from public.transactions where id = $1",
      [ids.privateEntry],
    );
    expect(legacy[0]?.deduct_from_agency_cut).toBe(true);

    const { rows } = await asUser(ids.executive, () =>
      db.query<{ category: string; deduct_from_agency_cut: boolean }>(`
        insert into public.transactions (kind, amount, category, deduct_from_agency_cut)
        values ('expense', 10, 'deducted QA', true), ('expense', 5, 'non-deducted QA', false)
        returning category, deduct_from_agency_cut
      `),
    );
    expect(rows).toEqual([
      { category: "deducted QA", deduct_from_agency_cut: true },
      { category: "non-deducted QA", deduct_from_agency_cut: false },
    ]);

    const { rows: updated } = await asUser(ids.executive, () =>
      db.query<{ deduct_from_agency_cut: boolean }>(
        "update public.transactions set deduct_from_agency_cut = false where category = 'deducted QA' returning deduct_from_agency_cut",
      ),
    );
    expect(updated[0]?.deduct_from_agency_cut).toBe(false);
  });

  it("allows repeated expense references while preserving separate edits and deletion", async () => {
    const externalRef = "OnlyMonster monthly subscription";
    const { rows } = await asUser(ids.executive, () =>
      db.query<{
        id: string;
        amount: string;
        currency: string;
        occurred_on: string;
        category: string;
        deduct_from_agency_cut: boolean;
      }>(
        `insert into public.transactions
          (kind, amount, currency, occurred_on, category, external_ref, deduct_from_agency_cut)
        values
          ('expense', 19.99, 'USD', '2026-10-01', 'Subscription October', $1, true),
          ('expense', 24.99, 'USD', '2026-11-01', 'Subscription November', $1, false)
        returning id, amount::text, currency, occurred_on::text, category, deduct_from_agency_cut`,
        [externalRef],
      ),
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.map((row) => row.amount)).toEqual(["19.99", "24.99"]);
    expect(rows.map((row) => row.deduct_from_agency_cut)).toEqual([true, false]);

    const [first, second] = rows;
    const [initialSummary] = summarize([
      {
        kind: "expense",
        amount: first!.amount,
        currency: first!.currency,
        occurred_on: first!.occurred_on,
        deduct_from_agency_cut: first!.deduct_from_agency_cut,
      },
      {
        kind: "expense",
        amount: second!.amount,
        currency: second!.currency,
        occurred_on: second!.occurred_on,
        deduct_from_agency_cut: second!.deduct_from_agency_cut,
      },
    ]);
    expect(initialSummary).toMatchObject({ expenses: 44.98, deductibleExpenses: 19.99 });

    await asUser(ids.executive, () =>
      db.query(
        "update public.transactions set amount = 20.99, category = 'Updated October' where id = $1",
        [first!.id],
      ),
    );
    const { rows: afterEdit } = await db.query<{ id: string; amount: string; category: string }>(
      "select id, amount::text, category from public.transactions where id = any($1::uuid[]) order by id",
      [[first!.id, second!.id]],
    );
    expect(afterEdit).toContainEqual({
      id: first!.id,
      amount: "20.99",
      category: "Updated October",
    });
    expect(afterEdit).toContainEqual({
      id: second!.id,
      amount: "24.99",
      category: "Subscription November",
    });

    await asUser(ids.executive, () => db.query("select public.delete_expense($1)", [first!.id]));
    const { rows: afterDelete } = await db.query<{
      id: string;
      external_ref: string;
      amount: string;
      category: string;
    }>(
      "select id, external_ref, amount::text, category from public.transactions where external_ref = $1",
      [externalRef],
    );
    expect(afterDelete).toEqual([
      {
        id: second!.id,
        external_ref: externalRef,
        amount: "24.99",
        category: "Subscription November",
      },
    ]);
  });

  it("keeps external reference uniqueness for revenue and payouts", async () => {
    await asUser(ids.executive, () =>
      db.query(
        "insert into public.transactions (kind, amount, category, external_ref) values ('revenue', 10, 'QA revenue', 'unique-revenue-ref')",
      ),
    );
    await expect(
      asUser(ids.executive, () =>
        db.query(
          "insert into public.transactions (kind, amount, category, external_ref) values ('revenue', 1, 'QA revenue duplicate', 'unique-revenue-ref')",
        ),
      ),
    ).rejects.toThrow(/transactions_non_expense_external_ref_key/i);

    await asUser(ids.executive, () =>
      db.query(
        "insert into public.transactions (kind, amount, category, creator_id, external_ref) values ('payout', 1, 'QA payout', $1, 'unique-payout-ref')",
        [ids.creatorAccount],
      ),
    );
    await expect(
      asUser(ids.executive, () =>
        db.query(
          "insert into public.transactions (kind, amount, category, creator_id, external_ref) values ('payout', 0.50, 'QA duplicate payout', $1, 'unique-payout-ref')",
          [ids.creatorAccount],
        ),
      ),
    ).rejects.toThrow(/transactions_non_expense_external_ref_key/i);
  });

  it("exposes only explicitly shared entries to their creator account", async () => {
    const { rows } = await asUser(ids.creator, () =>
      db.query<{ id: string }>(
        "select id from public.transactions where id in ($1, $2) order by id",
        [ids.sharedEntry, ids.privateEntry],
      ),
    );
    expect(rows.map((row) => row.id)).toEqual([ids.sharedEntry]);
  });

  it("limits payouts to earned balance and protects existing payouts from ledger edits", async () => {
    await asUser(ids.executive, () =>
      db.query(
        "insert into public.transactions (kind, amount, category, creator_id) values ('payout', 20, 'QA payout', $1)",
        [ids.creatorAccount],
      ),
    );

    await expect(
      asUser(ids.executive, () =>
        db.query(
          "insert into public.transactions (kind, amount, category, creator_id) values ('payout', 0.01, 'QA overspend', $1)",
          [ids.creatorAccount],
        ),
      ),
    ).rejects.toThrow(/exceeds.*earned balance/i);

    await expect(
      asUser(ids.executive, () =>
        db.query("update public.transactions set amount = 40 where id = $1", [ids.sharedEntry]),
      ),
    ).rejects.toThrow(/leave.*earned balance below zero/i);

    await expect(
      asUser(ids.executive, () =>
        db.query("update public.transactions set archived_at = now() where id = $1", [
          ids.sharedEntry,
        ]),
      ),
    ).rejects.toThrow(/leave.*earned balance below zero/i);

    const { rows } = await asUser(ids.executive, () =>
      db.query<{ count: string }>(
        "select count(*)::text as count from public.transactions where kind = 'payout' and archived_at is null",
      ),
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("requires a creator for payouts and restores availability when a payout is voided", async () => {
    await expect(
      asUser(ids.executive, () =>
        db.query(
          "insert into public.transactions (kind, amount, category) values ('payout', 1, 'QA payout')",
        ),
      ),
    ).rejects.toThrow(/select the creator/i);

    const { rows } = await asUser(ids.executive, () =>
      db.query<{ id: string }>(
        "insert into public.transactions (kind, amount, category, creator_id) values ('payout', 20, 'QA payout', $1) returning id",
        [ids.creatorAccount],
      ),
    );
    const payoutId = rows[0]?.id;
    expect(payoutId).toBeTruthy();

    await asUser(ids.executive, () =>
      db.query("update public.transactions set archived_at = now() where id = $1", [payoutId]),
    );
    await expect(
      asUser(ids.executive, () =>
        db.query("update public.transactions set archived_at = null where id = $1", [payoutId]),
      ),
    ).resolves.toBeDefined();
  });

  it("posts payouts only for executives, binds them to a creator, and safely retries", async () => {
    const payoutId = "00000000-0000-0000-0000-000000000301";
    const payoutArgs = [
      payoutId,
      ids.creatorAccount,
      20,
      "USD",
      "2026-10-23",
      "Creator payout",
      "Synthetic integration payout",
      "qa-payout-001",
      true,
    ] as const;
    const query = () =>
      db.query<{ post_creator_payout: string }>(
        `select public.post_creator_payout(
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        ) as post_creator_payout`,
        [...payoutArgs],
      );

    const { rows: privileges } = await db.query<{
      authenticated_can_execute: boolean;
      anon_can_execute: boolean;
    }>(`select
      has_function_privilege(
        'authenticated',
        'public.post_creator_payout(uuid,uuid,numeric,text,date,text,text,text,boolean)',
        'EXECUTE'
      ) as authenticated_can_execute,
      has_function_privilege(
        'anon',
        'public.post_creator_payout(uuid,uuid,numeric,text,date,text,text,text,boolean)',
        'EXECUTE'
      ) as anon_can_execute`);
    expect(privileges[0]).toEqual({ authenticated_can_execute: true, anon_can_execute: false });

    await expect(asUser(ids.employee, query)).rejects.toThrow(/only executives/i);

    const first = await asUser(ids.executive, query);
    const retry = await asUser(ids.executive, query);
    expect(first.rows[0]?.post_creator_payout).toBe(payoutId);
    expect(retry.rows[0]?.post_creator_payout).toBe(payoutId);

    const { rows } = await db.query<{
      id: string;
      creator_id: string;
      created_by: string;
    }>(
      `select id, creator_id, created_by
       from public.transactions where id = $1`,
      [payoutId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: payoutId,
      creator_id: ids.creatorAccount,
      created_by: ids.executive,
    });

    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.post_creator_payout(
          $1, $2, 20.01, $3, $4, $5, $6, $7, $8
        )`,
          [
            "00000000-0000-0000-0000-000000000302",
            ids.creatorAccount,
            "USD",
            "2026-10-23",
            "Overspend",
            null,
            null,
            false,
          ],
        ),
      ),
    ).rejects.toThrow(/exceeds.*earned balance/i);

    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.post_creator_payout(
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )`,
          [
            payoutId,
            ids.creatorAccount,
            19,
            "USD",
            "2026-10-23",
            "Creator payout",
            "Synthetic integration payout",
            "qa-payout-001",
            true,
          ],
        ),
      ),
    ).rejects.toThrow(/retry does not match/i);
  });

  it("rejects payouts without an active source creator", async () => {
    await db.query("update public.creators set archived_at = now() where id = $1", [
      ids.creatorAccount,
    ]);
    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.post_creator_payout(
            $1, $2, $3, $4, $5, $6, $7, $8, $9
          )`,
          [
            "00000000-0000-0000-0000-000000000303",
            ids.creatorAccount,
            1,
            "USD",
            "2026-10-23",
            "Archived creator payout",
            null,
            null,
            false,
          ],
        ),
      ),
    ).rejects.toThrow(/source creator is unavailable/i);
  });
});
