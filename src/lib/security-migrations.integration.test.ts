// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0011_creator_private_details.sql"),
  "utf8",
);

const ids = {
  executive: "00000000-0000-0000-0000-000000000001",
  assignedEmployee: "00000000-0000-0000-0000-000000000002",
  creator: "00000000-0000-0000-0000-000000000003",
  manager: "00000000-0000-0000-0000-000000000004",
  revokedExecutive: "00000000-0000-0000-0000-000000000005",
  unrelatedEmployee: "00000000-0000-0000-0000-000000000006",
  creatorA: "00000000-0000-0000-0000-000000000101",
  creatorB: "00000000-0000-0000-0000-000000000102",
  visibleTask: "00000000-0000-0000-0000-000000000201",
  hiddenTask: "00000000-0000-0000-0000-000000000202",
};

let db: PGlite;

async function runMigration() {
  await db.exec("begin");
  await db.exec(migration);
  await db.exec("commit");
}

async function selectAs(userId: string, table: string) {
  await db.exec("reset role");
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`,
  );
  const { rows } = await db.query(`select * from public.${table}`);
  await db.exec("reset role");
  return rows;
}

describe("creator privacy migration against PostgreSQL", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create type public.app_role as enum ('executive', 'employee', 'creator');
      create type public.work_area as enum ('creator_management');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.profiles (
        id uuid primary key,
        membership_removed_at timestamptz,
        access_revoked_at timestamptz
      );
      create table public.user_roles (user_id uuid not null, role public.app_role not null);
      create table public.user_areas (user_id uuid not null, area public.work_area not null);
      create table public.creators (
        id uuid primary key,
        user_id uuid,
        internal_notes text,
        internal_photo_path text
      );
      create table public.creator_assignments (creator_id uuid, user_id uuid);
      create table public.tasks (
        id uuid primary key,
        creator_id uuid,
        owner_id uuid,
        created_by uuid,
        visible_to_creator boolean not null
      );
      create table public.task_comments (
        id uuid primary key,
        task_id uuid not null,
        author_id uuid not null,
        body text not null
      );
      grant usage on schema public, auth to authenticated;
      grant execute on all functions in schema auth to authenticated;
      grant select, insert, update, delete on public.creators to authenticated;
      grant select, insert, update, delete on public.task_comments to authenticated;
      alter table public.creators enable row level security;
      alter table public.task_comments enable row level security;
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
      create function public.has_area(_area public.work_area) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.has_role(auth.uid(), 'employee')
          and exists (select 1 from public.user_areas where user_id = auth.uid() and area = _area)
      $$;
      create function public.can_access_creator(_creator_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.is_active_member(auth.uid()) and (
          public.is_executive()
          or exists (
            select 1 from public.creator_assignments
            where creator_id = _creator_id and user_id = auth.uid()
          )
          or public.has_area('creator_management')
        )
      $$;
      create function public.is_own_creator(_creator_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.is_active_member(auth.uid())
          and exists (
            select 1 from public.creators where id = _creator_id and user_id = auth.uid()
          )
      $$;
      create function public.can_see_task(_task_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
        select public.is_active_member(auth.uid()) and exists (
          select 1 from public.tasks t where t.id = _task_id and (
            public.is_executive()
            or t.owner_id = auth.uid()
            or t.created_by = auth.uid()
            or (t.creator_id is not null
              and public.has_role(auth.uid(), 'employee')
              and public.can_access_creator(t.creator_id))
            or (t.visible_to_creator and t.creator_id is not null
              and public.is_own_creator(t.creator_id))
          )
        )
      $$;
      grant execute on all functions in schema public to authenticated;
      create policy "creators read" on public.creators for select to authenticated
        using (public.is_active_member(auth.uid()) and (
          (public.has_role(auth.uid(), 'employee') and public.can_access_creator(id))
          or public.is_executive() or user_id = auth.uid()
        ));
      create policy "comments read" on public.task_comments for select to authenticated
        using (public.can_see_task(task_id));
      insert into public.profiles (id) values
        ('${ids.executive}'), ('${ids.assignedEmployee}'), ('${ids.creator}'),
        ('${ids.manager}'), ('${ids.revokedExecutive}'), ('${ids.unrelatedEmployee}');
      update public.profiles set access_revoked_at = now()
        where id = '${ids.revokedExecutive}';
      insert into public.user_roles (user_id, role) values
        ('${ids.executive}', 'executive'),
        ('${ids.assignedEmployee}', 'employee'),
        ('${ids.creator}', 'creator'),
        ('${ids.manager}', 'employee'),
        ('${ids.revokedExecutive}', 'executive'),
        ('${ids.unrelatedEmployee}', 'employee');
      insert into public.user_areas (user_id, area) values
        ('${ids.manager}', 'creator_management');
      insert into public.creators (id, user_id, internal_notes, internal_photo_path) values
        ('${ids.creatorA}', '${ids.creator}', 'source A notes', 'a/internal.jpg'),
        ('${ids.creatorB}', null, 'source B notes', null);
      insert into public.creator_assignments (creator_id, user_id) values
        ('${ids.creatorA}', '${ids.assignedEmployee}');
      insert into public.tasks (id, creator_id, visible_to_creator) values
        ('${ids.visibleTask}', '${ids.creatorA}', true),
        ('${ids.hiddenTask}', '${ids.creatorB}', false);
      insert into public.task_comments (id, task_id, author_id, body) values
        ('00000000-0000-0000-0000-000000000301', '${ids.visibleTask}', '${ids.executive}', 'staff note'),
        ('00000000-0000-0000-0000-000000000302', '${ids.hiddenTask}', '${ids.executive}', 'private staff note');
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it("preserves source and existing data, and is safe to re-run", async () => {
    await db.exec(`
      create table public.creator_private_details (
        creator_id uuid primary key references public.creators(id) on delete cascade,
        internal_notes text,
        internal_photo_path text
      );
      insert into public.creator_private_details values
        ('${ids.creatorB}', 'retained notes', 'b/existing.jpg');
    `);
    await runMigration();
    await runMigration();

    const { rows } = await db.query(
      `select creator_id, internal_notes, internal_photo_path
       from public.creator_private_details order by creator_id`,
    );
    expect(rows).toEqual([
      {
        creator_id: ids.creatorA,
        internal_notes: "source A notes",
        internal_photo_path: "a/internal.jpg",
      },
      {
        creator_id: ids.creatorB,
        internal_notes: "source B notes",
        internal_photo_path: "b/existing.jpg",
      },
    ]);
    const { rows: sourceColumns } = await db.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'creators'
         and column_name in ('internal_notes', 'internal_photo_path')`,
    );
    expect(sourceColumns).toEqual([]);
  });

  it("creates the private table and backfills both source fields", async () => {
    await runMigration();

    const { rows } = await db.query(
      `select creator_id, internal_notes, internal_photo_path
       from public.creator_private_details order by creator_id`,
    );
    expect(rows).toEqual([
      {
        creator_id: ids.creatorA,
        internal_notes: "source A notes",
        internal_photo_path: "a/internal.jpg",
      },
      {
        creator_id: ids.creatorB,
        internal_notes: "source B notes",
        internal_photo_path: null,
      },
    ]);
  });

  it("rolls back the private-data move and policy changes after a transaction failure", async () => {
    await db.exec("begin");
    await db.exec(migration);
    await expect(db.exec("select 1 / 0")).rejects.toThrow();
    await db.exec("rollback");

    const { rows } = await db.query(
      `select internal_notes, internal_photo_path from public.creators where id = '${ids.creatorA}'`,
    );
    expect(rows).toEqual([
      { internal_notes: "source A notes", internal_photo_path: "a/internal.jpg" },
    ]);
    const { rows: privateTable } = await db.query<{ name: string | null }>(
      `select to_regclass('public.creator_private_details') as name`,
    );
    expect(privateTable[0]?.name).toBeNull();
    const { rows: rlsPolicies } = await db.query(
      `select policyname from pg_policies
       where schemaname = 'public' and tablename = 'creator_private_details'`,
    );
    expect(rlsPolicies).toEqual([]);

    await runMigration();
  });

  it("enforces private-detail and staff-comment access with authenticated database roles", async () => {
    await runMigration();

    await expect(selectAs(ids.executive, "creator_private_details")).resolves.toHaveLength(2);
    await expect(selectAs(ids.assignedEmployee, "creator_private_details")).resolves.toHaveLength(
      1,
    );
    await expect(selectAs(ids.manager, "creator_private_details")).resolves.toHaveLength(2);
    await expect(selectAs(ids.creator, "creator_private_details")).resolves.toHaveLength(0);
    await expect(selectAs(ids.revokedExecutive, "creator_private_details")).resolves.toHaveLength(
      0,
    );
    await expect(selectAs(ids.unrelatedEmployee, "creator_private_details")).resolves.toHaveLength(
      0,
    );

    await expect(selectAs(ids.executive, "task_comments")).resolves.toHaveLength(2);
    await expect(selectAs(ids.assignedEmployee, "task_comments")).resolves.toHaveLength(1);
    await expect(selectAs(ids.manager, "task_comments")).resolves.toHaveLength(2);
    await expect(selectAs(ids.creator, "task_comments")).resolves.toHaveLength(0);
    await expect(selectAs(ids.revokedExecutive, "task_comments")).resolves.toHaveLength(0);

    await db.exec(
      `set role authenticated;
       select set_config('request.jwt.claim.sub', '${ids.creator}', false)`,
    );
    await expect(
      db.exec(
        `insert into public.creator_private_details (creator_id, internal_notes)
         values ('${ids.creatorB}', 'creator write attempt')`,
      ),
    ).rejects.toThrow();
    await db.exec("reset role");
  });
});
