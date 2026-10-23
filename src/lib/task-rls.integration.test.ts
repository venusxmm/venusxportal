// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0012_task_returning_rls.sql"),
  "utf8",
);

const ids = {
  executive: "00000000-0000-0000-0000-000000000001",
  employeeA: "00000000-0000-0000-0000-000000000002",
  employeeB: "00000000-0000-0000-0000-000000000003",
  unassigned: "00000000-0000-0000-0000-000000000004",
  creatorA: "00000000-0000-0000-0000-000000000101",
  creatorB: "00000000-0000-0000-0000-000000000102",
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

function taskIdFrom(rows: { id: string }[]) {
  const row = rows[0];
  if (!row) throw new Error("Expected the task insert to return its id.");
  return row.id;
}

describe("task row-level security integration", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role authenticated nologin;
      create schema auth;
      create type public.app_role as enum ('executive', 'employee', 'creator');
      create type public.work_area as enum ('creator_management');
      create table public.profiles (
        id uuid primary key,
        membership_removed_at timestamptz,
        access_revoked_at timestamptz
      );
      create table public.user_roles (user_id uuid not null, role public.app_role not null);
      create table public.user_areas (user_id uuid not null, area public.work_area not null);
      create table public.creators (id uuid primary key, user_id uuid);
      create table public.creator_assignments (creator_id uuid, user_id uuid);
      create table public.tasks (
        id uuid primary key default gen_random_uuid(),
        title text not null,
        creator_id uuid,
        owner_id uuid,
        created_by uuid,
        visible_to_creator boolean not null default false
      );
      grant usage on schema public, auth to authenticated;
      grant execute on all functions in schema auth to authenticated;
      grant select, insert, update on public.tasks to authenticated;
      alter table public.tasks enable row level security;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
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
      create policy "tasks read" on public.tasks for select to authenticated
        using (public.can_see_task(id));
      create policy "tasks insert" on public.tasks for insert to authenticated
        with check (
          (public.is_executive() or public.has_role(auth.uid(), 'employee'))
          and (creator_id is null or public.can_access_creator(creator_id))
        );
      create policy "tasks update staff" on public.tasks for update to authenticated
        using (
          public.is_executive()
          or (public.has_role(auth.uid(), 'employee') and public.can_see_task(id))
        );
      insert into public.profiles (id) values
        ('${ids.executive}'), ('${ids.employeeA}'), ('${ids.employeeB}'),
        ('${ids.unassigned}');
      insert into public.user_roles (user_id, role) values
        ('${ids.executive}', 'executive'),
        ('${ids.employeeA}', 'employee'),
        ('${ids.employeeB}', 'employee');
      insert into public.creators (id) values ('${ids.creatorA}'), ('${ids.creatorB}');
      insert into public.creator_assignments (creator_id, user_id)
        values ('${ids.creatorA}', '${ids.employeeA}');
    `);
    await db.exec(migration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("allows an executive to insert and return a task", async () => {
    const { rows } = await asUser(ids.executive, () =>
      db.query<{ id: string }>(
        "insert into public.tasks (title, created_by) values ('Executive task', auth.uid()) returning id",
      ),
    );

    expect(rows).toHaveLength(1);
  });

  it("allows an employee to insert, read, and update an in-scope task", async () => {
    const { rows } = await asUser(ids.employeeA, () =>
      db.query<{ id: string }>(
        "insert into public.tasks (title, creator_id, created_by) values ('Scoped task', $1, auth.uid()) returning id",
        [ids.creatorA],
      ),
    );
    const taskId = taskIdFrom(rows);
    const visible = await asUser(ids.employeeA, () =>
      db.query("select id from public.tasks where id = $1", [taskId]),
    );
    const updated = await asUser(ids.employeeA, () =>
      db.query("update public.tasks set title = 'Updated task' where id = $1 returning id", [
        taskId,
      ]),
    );

    expect(visible.rows).toHaveLength(1);
    expect(updated.rows).toHaveLength(1);
  });

  it("does not expose an operator's private task to another operator", async () => {
    const { rows } = await asUser(ids.employeeA, () =>
      db.query<{ id: string }>(
        "insert into public.tasks (title, created_by) values ('Private task', auth.uid()) returning id",
      ),
    );
    const taskId = taskIdFrom(rows);
    const hidden = await asUser(ids.employeeB, () =>
      db.query<{ id: string }>("select id from public.tasks where id = $1", [taskId]),
    );

    expect(hidden.rows).toHaveLength(0);
  });

  it("continues to reject employees without access to the selected creator", async () => {
    await expect(
      asUser(ids.employeeB, () =>
        db.query<{ id: string }>(
          "insert into public.tasks (title, creator_id, created_by) values ('Out of scope', $1, auth.uid()) returning id",
          [ids.creatorB],
        ),
      ),
    ).rejects.toThrow(/row-level security policy/i);
  });

  it("continues to reject an authenticated user without an authorized role", async () => {
    await expect(
      asUser(ids.unassigned, () =>
        db.query<{ id: string }>(
          "insert into public.tasks (title, created_by) values ('Unauthorized task', auth.uid()) returning id",
        ),
      ),
    ).rejects.toThrow(/row-level security policy/i);
  });
});
