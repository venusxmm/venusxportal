// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0004_invitations.sql"),
  "utf8",
);
const creatorAuthMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0019_creator_invitation_auth_flow.sql"),
  "utf8",
);
const creatorWorkspaceMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0020_creator_invitation_workspace_binding.sql"),
  "utf8",
);
const memberRecoveryMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0021_explicit_member_recovery.sql"),
  "utf8",
);
const disableRecoveryMigration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0022_disable_explicit_access_recovery.sql"), "utf8");
const regrantMigration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0023_invitation_delivery_and_explicit_regrant.sql"), "utf8");
const memberAccessSql = readFileSync(resolve(process.cwd(), "drizzle/migrations/0010_team_member_removal.sql"), "utf8");
const memberAccessFunctions = memberAccessSql.slice(memberAccessSql.indexOf("create or replace function public.revoke_team_member_access"), memberAccessSql.indexOf("create or replace function public.restore_team_member_on_role_grant"));
const ids = {
  executive: "00000000-0000-0000-0000-000000000001",
  employee: "00000000-0000-0000-0000-000000000002",
  invitedUser: "00000000-0000-0000-0000-000000000003",
  wrongUser: "00000000-0000-0000-0000-000000000004",
  linkedUser: "00000000-0000-0000-0000-000000000005",
  creatorUser: "00000000-0000-0000-0000-000000000006",
  unverifiedUser: "00000000-0000-0000-0000-000000000008",
  revokedUser: "00000000-0000-0000-0000-000000000009",
  removedUser: "00000000-0000-0000-0000-00000000000a",
  revokedCreator: "00000000-0000-0000-0000-00000000000b",
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
      create type public.app_role as enum ('executive', 'employee', 'creator', 'partner');
      create type public.work_area as enum (
        'marketing', 'sharing', 'operations', 'creator_management',
        'chatting', 'creator_manager', 'admin'
      );
      create table auth.users (
        id uuid primary key,
        email text,
        email_confirmed_at timestamptz,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create table public.profiles (
        id uuid primary key,
        email text,
        full_name text,
        membership_removed_at timestamptz,
        access_revoked_at timestamptz
      );
      create table public.creators (
        id uuid primary key default gen_random_uuid(),
        email text,
        user_id uuid unique,
        archived_at timestamptz
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
      create table public.audit_events (
        id uuid primary key default gen_random_uuid(),
        actor_id uuid,
        entity text not null,
        entity_id uuid,
        action text not null,
        details jsonb,
        created_at timestamptz not null default now()
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
      create function public.has_role(_user_id uuid, _role public.app_role) returns boolean
      language sql stable security definer set search_path = public as $$
          select public.is_active_member(_user_id)
            and exists (
              select 1 from public.user_roles
              where user_id = _user_id and role = _role
            )
      $$;
      insert into public.profiles (id, email) values
          ('${ids.executive}', null), ('${ids.employee}', null), ('${ids.invitedUser}', null),
          ('${ids.wrongUser}', null), ('${ids.linkedUser}', null),
          ('${ids.revokedUser}', 'recover.creator@example.test'),
          ('${ids.removedUser}', 'removed.member@example.test');
      update public.profiles set access_revoked_at = now()
        where id = '${ids.revokedUser}';
      update public.profiles set access_revoked_at = now(), membership_removed_at = now()
        where id = '${ids.removedUser}';
      insert into public.user_roles (user_id, role) values
        ('${ids.executive}', 'executive'), ('${ids.employee}', 'employee');
      insert into auth.users (id, email, email_confirmed_at) values
        ('${ids.executive}', 'executive@example.test', now()),
        ('${ids.employee}', 'employee@example.test', now()),
        ('${ids.invitedUser}', 'invited@example.test', now()),
        ('${ids.wrongUser}', 'other@example.test', now()),
        ('${ids.revokedUser}', 'recover.creator@example.test', now()),
        ('${ids.removedUser}', 'removed.member@example.test', now());
    `);
    await db.exec(migration);
    await db.exec(creatorAuthMigration);
    await db.exec(creatorWorkspaceMigration);
    await db.exec(memberRecoveryMigration);
    await db.exec(disableRecoveryMigration);
    await db.exec(memberAccessFunctions);
    await db.exec(regrantMigration);
    await db.exec(`
      create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
    `);
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
    const acceptedAgain = await asUser(ids.invitedUser, () =>
      db.query<{ accept_invitation: boolean }>(`select public.accept_invitation('${validToken}')`),
    );
    expect(acceptedAgain.rows[0]?.accept_invitation).toBe(true);
  });

  it("supports Executive and Partner invitations for an existing identity without duplicating its profile", async () => {
    const existingUser = "00000000-0000-0000-0000-00000000000c";
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, 'existing.roles@example.test', now())`,
      [existingUser],
    );

    for (const [role, token] of [
      ["executive", "7".repeat(64)],
      ["partner", "8".repeat(64)],
    ] as const) {
      await asUser(ids.executive, () =>
        db.query(
          `select public.create_invitation('existing.roles@example.test', '${token}', '${role}')`,
        ),
      );
      const accepted = await asUser(existingUser, () =>
        db.query<{ accept_invitation: boolean }>(`select public.accept_invitation('${token}')`),
      );
      expect(accepted.rows[0]?.accept_invitation).toBe(true);
    }

    const roles = await db.query<{ role: string }>(
      "select role from public.user_roles where user_id = $1 order by role",
      [existingUser],
    );
    expect(roles.rows).toEqual([{ role: "executive" }, { role: "partner" }]);
    const profiles = await db.query<{ count: string }>(
      "select count(*)::text as count from public.profiles where id = $1",
      [existingUser],
    );
    expect(profiles.rows).toEqual([{ count: "1" }]);
  });

  it("rejects expired and malformed invitation tokens", async () => {
    await db.query(
      `insert into public.invitations (email, token_hash, role, expires_at, created_by)
       values ('invited@example.test', $1, 'employee', now() - interval '1 day', $2)`,
      ["c".repeat(64), ids.executive],
    );

    const expiredStatus = await db.query<{
      get_invitation_status: { status: string; account_state: string };
    }>(`select public.get_invitation_status('${"c".repeat(64)}')`);
    expect(expiredStatus.rows[0]?.get_invitation_status).toMatchObject({
      status: "expired",
      account_state: "verified",
    });

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

  it("revokes effective access and permanently removes membership without deleting business records", async () => {
    await db.query("insert into public.creators(id,email,user_id) values($1,$2,$3)", [ids.revokedCreator,"employee@example.test",ids.employee]);
    expect((await asUser(ids.executive, () => db.query(`select public.revoke_team_member_access('${ids.employee}') as result`))).rows).toEqual([{result:true}]);
    expect((await db.query(`select public.is_active_member('${ids.employee}') as active`)).rows).toEqual([{active:false}]);
    expect((await db.query("select * from public.user_roles where user_id=$1",[ids.employee])).rows).toHaveLength(0);
    expect((await asUser(ids.executive, () => db.query(`select public.remove_team_member('${ids.employee}') as result`))).rows).toEqual([{result:true}]);
    expect((await db.query("select id from public.profiles where id=$1 and membership_removed_at is not null",[ids.employee])).rows).toHaveLength(1);
    expect((await db.query("select user_id from public.creators where id=$1",[ids.revokedCreator])).rows).toEqual([{user_id:ids.employee}]);
    expect((await db.query("select id from auth.users where id=$1",[ids.employee])).rows).toHaveLength(1);
  });

  it("denies recovery creation and preserves removed access against profile and role changes", async () => {
    await expect(asUser(ids.executive, () => db.query(`select public.create_recovery_invitation('${ids.removedUser}', '${"f".repeat(64)}', 'employee', '{}', 'No longer allowed')`))).rejects.toThrow(/permission denied/i);
    await expect(db.query("update public.profiles set membership_removed_at=null,access_revoked_at=null where id=$1", [ids.removedUser])).rejects.toThrow(/cannot be restored/i);
    await db.exec("create trigger block_restoration after insert on public.user_roles for each row execute function public.restore_team_member_on_role_grant()");
    await expect(db.query("insert into public.user_roles values ($1,'employee')", [ids.removedUser])).rejects.toThrow(/cannot restore/i);
    const rows = await db.query("select id from public.profiles where id=$1 and membership_removed_at is not null and access_revoked_at is not null", [ids.removedUser]);
    expect(rows.rows).toHaveLength(1);
  });

  it("rejects stale recovery invitations without changing Creator business data", async () => {
    const token = "e".repeat(64);
    await db.query("insert into public.creators(id,email,user_id) values($1,$2,$3)", [ids.revokedCreator,"recover.creator@example.test",ids.revokedUser]);
    await db.query("insert into public.invitations(email,token_hash,role,created_by,recovery_user_id) values($1,$2,'creator',$3,$4)", ["recover.creator@example.test",token,ids.executive,ids.revokedUser]);
    await expect(asUser(ids.revokedUser, () => db.query(`select public.accept_invitation('${token}')`))).rejects.toThrow(/legacy access invitation/i);
    await db.query("update public.invitations set revoked_at=now() where token_hash=$1", [token]);
    expect((await db.query("select user_id from public.creators where id=$1",[ids.revokedCreator])).rows).toEqual([{user_id:ids.revokedUser}]);
  });

  it("restores removed access only through a new invitation accepted by the matching identity", async () => {
    const stale = "7".repeat(64);
    await db.query("insert into public.invitations(email,token_hash,role,created_by,created_at) values($1,$2,'executive',$3,now()-interval '1 day')", ["removed.member@example.test", stale, ids.executive]);
    await expect(asUser(ids.removedUser, () => db.query(`select public.accept_invitation('${stale}')`))).rejects.toThrow(/predates the access removal/i);
    await db.query("update public.invitations set revoked_at=now() where token_hash=$1", [stale]);
    const fresh = "8".repeat(64);
    await asUser(ids.executive, () => db.query(`select public.create_invitation('removed.member@example.test','${fresh}','employee')`));
    await expect(asUser(ids.wrongUser, () => db.query(`select public.accept_invitation('${fresh}')`))).rejects.toThrow(/invited email/i);
    await asUser(ids.removedUser, () => db.query(`select public.accept_invitation('${fresh}')`));
    expect((await db.query("select role from public.user_roles where user_id=$1", [ids.removedUser])).rows).toEqual([{ role: "employee" }]);
    expect((await db.query(`select public.is_active_member('${ids.removedUser}') as active`)).rows).toEqual([{ active: true }]);
    await expect(asUser(ids.removedUser, () => db.query(`select public.accept_invitation('${stale}')`))).rejects.toThrow(/invalid or expired/i);
  });

  it("prevents non-executives from revoking invites and rejects revoked tokens", async () => {
    const invite = await asUser(ids.executive, () =>
      db.query<{ create_invitation: { id: string } }>(
        `select public.create_invitation('invited@example.test', '${validToken}', 'employee') as create_invitation`,
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
    const revokedStatus = await db.query<{ get_invitation_status: { status: string } }>(
      `select public.get_invitation_status('${validToken}')`,
    );
    expect(revokedStatus.rows[0]?.get_invitation_status.status).toBe("revoked");
    await expect(
      asUser(ids.invitedUser, () =>
        db.query<{ accept_invitation: boolean }>(
          `select public.accept_invitation('${validToken}')`,
        ),
      ),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it("links a verified Creator by normalized invitation email and remains idempotent", async () => {
    const token = "e".repeat(64);
    const spacedEmail = "\t Creator@Example.Test \n";
    await db.query("insert into public.creators (email) values ($1)", [spacedEmail]);
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, $2, now())`,
      [ids.creatorUser, spacedEmail],
    );
    const beforeAccept = await db.query<{ user_id: string | null }>(
      "select user_id from public.creators",
    );
    expect(beforeAccept.rows).toEqual([{ user_id: null }]);
    await asUser(ids.executive, () =>
      db.query(
        `select public.create_invitation(E'\\t creator@example.test \\n', '${token}', 'creator')`,
      ),
    );

    const firstAcceptance = await asUser(ids.creatorUser, () =>
      db.query<{ accept_invitation: boolean }>(`select public.accept_invitation('${token}')`),
    );
    expect(firstAcceptance.rows[0]?.accept_invitation).toBe(true);

    const linked = await db.query<{ user_id: string }>(
      "select user_id from public.creators where public._normalize_email_address(email) = 'creator@example.test'",
    );
    expect(linked.rows).toEqual([{ user_id: ids.creatorUser }]);

    const resolved = await asUser(ids.creatorUser, () =>
      db.query<{ resolve_creator_link: string }>("select public.resolve_creator_link()"),
    );
    expect(resolved.rows[0]?.resolve_creator_link).toBeTruthy();
    const repeatedAcceptance = await asUser(ids.creatorUser, () =>
      db.query<{ accept_invitation: boolean }>(`select public.accept_invitation('${token}')`),
    );
    expect(repeatedAcceptance.rows[0]?.accept_invitation).toBe(true);
    const acceptedStatus = await db.query<{ get_invitation_status: { status: string } }>(
      `select public.get_invitation_status('${token}')`,
    );
    expect(acceptedStatus.rows[0]?.get_invitation_status.status).toBe("accepted");
  });

  it("does not claim a Creator linked to another user or grant the invited role", async () => {
    const token = "f".repeat(64);
    await db.query(
      "insert into public.creators (email, user_id) values ('creator@example.test', $1)",
      [ids.linkedUser],
    );
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, 'creator@example.test', now())`,
      [ids.creatorUser],
    );
    await expect(
      asUser(ids.executive, () =>
        db.query(`select public.create_invitation('creator@example.test', '${token}', 'creator')`),
      ),
    ).rejects.toThrow(/already linked to another account/i);
    const roles = await db.query("select role from public.user_roles where user_id = $1", [
      ids.creatorUser,
    ]);
    expect(roles.rows).toHaveLength(0);
  });

  it("fails safely for duplicate or missing Creator profiles and unverified email", async () => {
    const duplicateToken = "1".repeat(64);
    await db.query(
      `insert into public.creators (email) values
        ('duplicate@example.test'), (' Duplicate@Example.Test ')`,
    );
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, 'duplicate@example.test', now())`,
      [ids.creatorUser],
    );
    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.create_invitation('duplicate@example.test', '${duplicateToken}', 'creator')`,
        ),
      ),
    ).rejects.toThrow(/more than one active creator profile/i);

    const missingToken = "2".repeat(64);
    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.create_invitation('missing@example.test', '${missingToken}', 'creator')`,
        ),
      ),
    ).rejects.toThrow(/no active creator profile matches/i);

    const unverifiedToken = "3".repeat(64);
    await db.query("insert into public.creators (email) values ('unverified@example.test')");
    await asUser(ids.executive, () =>
      db.query(
        `select public.create_invitation('unverified@example.test', '${unverifiedToken}', 'creator')`,
      ),
    );
    await db.query("insert into auth.users (id, email) values ($1, 'unverified@example.test')", [
      ids.unverifiedUser,
    ]);
    await expect(
      asUser(ids.unverifiedUser, () =>
        db.query(`select public.accept_invitation('${unverifiedToken}')`),
      ),
    ).rejects.toThrow(/confirm your email address|active account access/i);
  });

  it("does not link Creator profiles for other roles and reports invitation states", async () => {
    const token = "4".repeat(64);
    await asUser(ids.executive, () =>
      db.query(`select public.create_invitation('employee@example.test', '${token}', 'employee')`),
    );
    const status = await db.query<{ get_invitation_status: { status: string } }>(
      `select public.get_invitation_status('${token}')`,
    );
    expect(status.rows[0]?.get_invitation_status.status).toBe("pending");
    expect(status.rows[0]?.get_invitation_status).toHaveProperty("account_state", "verified");

    await asUser(ids.employee, () => db.query(`select public.accept_invitation('${token}')`));
    const resolved = await asUser(ids.employee, () =>
      db.query<{ resolve_creator_link: string | null }>("select public.resolve_creator_link()"),
    );
    expect(resolved.rows[0]?.resolve_creator_link).toBeNull();
    const invalidStatus = await db.query<{ get_invitation_status: { status: string } }>(
      `select public.get_invitation_status('${"0".repeat(64)}')`,
    );
    expect(invalidStatus.rows[0]?.get_invitation_status.status).toBe("invalid");
  });
});
