// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
      create table public.creators (id uuid primary key, user_id uuid);
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
        creator_id uuid references public.creators(id),
        agency_share_pct numeric check (agency_share_pct between 0 and 100),
        shared_with_creator boolean not null default false,
        archived_at timestamptz
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
  });

  afterEach(async () => {
    await db.close();
  });

  it("allows an executive to create, void, and restore an expense but prevents hard deletion", async () => {
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
    const { rows: auditRows } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.audit_events where entity_id = $1 and action in ('insert', 'update', 'delete')",
      [entryId],
    );
    expect(Number(auditRows[0]?.count)).toBe(3);
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
});
