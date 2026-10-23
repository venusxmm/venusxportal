// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0004_invitations.sql"),
  "utf8",
);
const ids = {
  executive: "00000000-0000-0000-0000-000000000001",
  employee: "00000000-0000-0000-0000-000000000002",
  invitedUser: "00000000-0000-0000-0000-000000000003",
  wrongUser: "00000000-0000-0000-0000-000000000004",
};
const validToken = "a".repeat(64);

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

describe("invitation row-level security integration", () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role authenticated nologin;
      create role anon nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create type public.app_role as enum ('executive', 'employee', 'creator');
      create type public.work_area as enum (
        'marketing', 'sharing', 'operations', 'creator_management',
        'chatting', 'creator_manager', 'admin'
      );
      create table auth.users (id uuid primary key, email text);
      create table public.profiles (
        id uuid primary key,
        membership_removed_at timestamptz,
        access_revoked_at timestamptz
      );
      create table public.user_roles (
        user_id uuid not null,
        role public.app_role not null,
        primary key (user_id, role)
      );
      create table public.user_areas (
        user_id uuid not null,
        area public.work_area not null,
        primary key (user_id, area)
      );
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
      create function public.is_executive() returns boolean
      language sql stable security definer set search_path = public as $$
        select public.is_active_member(auth.uid())
          and exists (
            select 1 from public.user_roles
            where user_id = auth.uid() and role = 'executive'
          )
      $$;
      insert into public.profiles (id) values
        ('${ids.executive}'), ('${ids.employee}'), ('${ids.invitedUser}'), ('${ids.wrongUser}');
      insert into public.user_roles (user_id, role) values
        ('${ids.executive}', 'executive'), ('${ids.employee}', 'employee');
      insert into auth.users (id, email) values
        ('${ids.executive}', 'executive@example.test'),
        ('${ids.employee}', 'employee@example.test'),
        ('${ids.invitedUser}', 'invited@example.test'),
        ('${ids.wrongUser}', 'other@example.test');
    `);
    await db.exec(migration);
  });

  afterEach(async () => {
    await db.close();
  });

  it("restricts invitation creation and listing to executives", async () => {
    const invite = await asUser(ids.executive, () =>
      db.query<{ create_invitation: { id: string; email: string } }>(
        `select public.create_invitation(
          'new.employee@example.test', '${validToken}', 'employee', array['marketing']::public.work_area[]
        ) as create_invitation`,
      ),
    );
    expect(invite.rows[0]?.create_invitation.email).toBe("new.employee@example.test");

    await expect(
      asUser(ids.employee, () =>
        db.query(
          `select public.create_invitation('denied@example.test', '${"b".repeat(64)}', 'employee')`,
        ),
      ),
    ).rejects.toThrow(/Only executives/i);

    const visibleToEmployee = await asUser(ids.employee, () =>
      db.query("select id from public.invitations"),
    );
    expect(visibleToEmployee.rows).toHaveLength(0);
  });

  it("accepts a pending invite only for the invited email and grants its role and area", async () => {
    await asUser(ids.executive, () =>
      db.query(
        `select public.create_invitation(
          'invited@example.test', '${validToken}', 'employee', array['operations']::public.work_area[]
        )`,
      ),
    );

    await expect(
      asUser(ids.wrongUser, () =>
        db.query<{ accept_invitation: boolean }>(
          `select public.accept_invitation('${validToken}')`,
        ),
      ),
    ).rejects.toThrow(/invited email address/i);

    const accepted = await asUser(ids.invitedUser, () =>
      db.query<{ accept_invitation: boolean }>(`select public.accept_invitation('${validToken}')`),
    );
    expect(accepted.rows[0]?.accept_invitation).toBe(true);

    const roles = await db.query<{ role: string }>(
      "select role from public.user_roles where user_id = $1",
      [ids.invitedUser],
    );
    const areas = await db.query<{ area: string }>(
      "select area from public.user_areas where user_id = $1",
      [ids.invitedUser],
    );
    expect(roles.rows).toEqual([{ role: "employee" }]);
    expect(areas.rows).toEqual([{ area: "operations" }]);
    await expect(
      asUser(ids.invitedUser, () =>
        db.query<{ accept_invitation: boolean }>(
          `select public.accept_invitation('${validToken}')`,
        ),
      ),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it("rejects expired and malformed invitation tokens", async () => {
    await db.query(
      `insert into public.invitations (email, token_hash, role, expires_at, created_by)
       values ('invited@example.test', $1, 'employee', now() - interval '1 day', $2)`,
      ["c".repeat(64), ids.executive],
    );

    await expect(
      asUser(ids.invitedUser, () =>
        db.query(`select public.accept_invitation('${"d".repeat(64)}')`),
      ),
    ).rejects.toThrow(/invalid or expired/i);
    await expect(
      asUser(ids.invitedUser, () =>
        db.query(`select public.accept_invitation('${"c".repeat(64)}')`),
      ),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it("prevents non-executives from revoking invites and rejects revoked tokens", async () => {
    const invite = await asUser(ids.executive, () =>
      db.query<{ create_invitation: { id: string } }>(
        `select public.create_invitation('invitee@example.test', '${validToken}', 'employee') as create_invitation`,
      ),
    );
    const inviteId = invite.rows[0]?.create_invitation.id;

    await expect(
      asUser(ids.employee, () =>
        db.query<{ revoke_invitation: boolean }>("select public.revoke_invitation($1)", [inviteId]),
      ),
    ).rejects.toThrow(/Only executives/i);

    const revoked = await asUser(ids.executive, () =>
      db.query<{ revoke_invitation: boolean }>("select public.revoke_invitation($1)", [inviteId]),
    );
    expect(revoked.rows[0]?.revoke_invitation).toBe(true);
    await expect(
      asUser(ids.invitedUser, () =>
        db.query<{ accept_invitation: boolean }>(
          `select public.accept_invitation('${validToken}')`,
        ),
      ),
    ).rejects.toThrow(/invalid or expired/i);
  });
});
