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
const teamAccessLifecycleMigration = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0022_team_access_membership_lifecycle.sql"),
  "utf8",
);
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
  removableUser: "00000000-0000-0000-0000-00000000000d",
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
          ('${ids.removedUser}', 'removed.member@example.test'),
          ('${ids.removableUser}', 'remove.member@example.test');
      update public.profiles set access_revoked_at = now()
        where id = '${ids.revokedUser}';
      update public.profiles set access_revoked_at = now(), membership_removed_at = now()
        where id = '${ids.removedUser}';
      insert into public.user_roles (user_id, role) values
        ('${ids.executive}', 'executive'), ('${ids.employee}', 'employee'),
        ('${ids.removableUser}', 'employee');
      insert into auth.users (id, email, email_confirmed_at) values
        ('${ids.executive}', 'executive@example.test', now()),
        ('${ids.employee}', 'employee@example.test', now()),
        ('${ids.invitedUser}', 'invited@example.test', now()),
        ('${ids.wrongUser}', 'other@example.test', now()),
        ('${ids.revokedUser}', 'recover.creator@example.test', now()),
        ('${ids.removedUser}', 'removed.member@example.test', now()),
        ('${ids.removableUser}', 'remove.member@example.test', now());
    `);
    await db.exec(migration);
    await db.exec(creatorAuthMigration);
    await db.exec(creatorWorkspaceMigration);
    await db.exec(memberRecoveryMigration);
    await db.exec(teamAccessLifecycleMigration);
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

  it("keeps ordinary invitations from restoring revoked accounts and supports audited, explicit recovery", async () => {
    const recoveryToken = "e".repeat(64);
    await db.query("insert into public.creators (id, email, user_id) values ($1, $2, $3)", [
      ids.revokedCreator,
      "recover.creator@example.test",
      ids.revokedUser,
    ]);
    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.create_invitation(
            'recover.creator@example.test', '${recoveryToken}', 'creator'
          )`,
        ),
      ),
    ).rejects.toThrow(/access was revoked/i);

    await expect(
      asUser(ids.employee, () =>
        db.query(
          `select public.create_recovery_invitation(
            '${ids.revokedUser}', '${recoveryToken}', 'creator', '{}', 'Restore approved Creator access'
          )`,
        ),
      ),
    ).rejects.toThrow(/only executives/i);

    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.create_recovery_invitation(
            '${ids.revokedUser}', '${"9".repeat(64)}', 'employee', '{}', 'Restore approved employee access'
          )`,
        ),
      ),
    ).rejects.toThrow(/only be recovered with the creator role/i);

    await asUser(ids.executive, () =>
      db.query(
        `select public.create_recovery_invitation(
          '${ids.revokedUser}', '${recoveryToken}', 'creator', '{}', 'Restore approved Creator access'
        )`,
      ),
    );

    await db.query("update auth.users set email = 'recover.creator@example.test' where id = $1", [
      ids.wrongUser,
    ]);
    await expect(
      asUser(ids.wrongUser, () => db.query(`select public.accept_invitation('${recoveryToken}')`)),
    ).rejects.toThrow(/belongs to another account/i);

    const accepted = await asUser(ids.revokedUser, () =>
      db.query<{ accept_invitation: boolean }>(
        `select public.accept_invitation('${recoveryToken}')`,
      ),
    );
    expect(accepted.rows[0]?.accept_invitation).toBe(true);

    const recovered = await db.query<{
      access_revoked_at: string | null;
      membership_removed_at: string | null;
    }>("select access_revoked_at, membership_removed_at from public.profiles where id = $1", [
      ids.revokedUser,
    ]);
    expect(recovered.rows[0]).toEqual({
      access_revoked_at: null,
      membership_removed_at: null,
    });

    const linkage = await db.query<{ user_id: string | null; role: string }>(
      `select c.user_id, r.role
       from public.creators c
       join public.user_roles r on r.user_id = c.user_id
       where c.id = $1`,
      [ids.revokedCreator],
    );
    expect(linkage.rows).toEqual([{ user_id: ids.revokedUser, role: "creator" }]);

    const audit = await db.query<{ action: string }>(
      "select action from public.audit_events where entity_id = (select id from public.invitations where token_hash = $1) order by action",
      [recoveryToken],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "accept_recovery_invitation",
      "create_recovery_invitation",
    ]);
  });

  it("allows a removed member to accept a normal invitation without restoring revoked accounts", async () => {
    const invitationToken = "f".repeat(64);
    const before = await db.query<{
      access_revoked_at: string | null;
      membership_removed_at: string | null;
      is_active_member: boolean;
    }>(
      `select access_revoked_at, membership_removed_at,
        public.is_active_member(id) as is_active_member
       from public.profiles where id = $1`,
      [ids.removedUser],
    );
    expect(before.rows[0]).toMatchObject({
      access_revoked_at: null,
      is_active_member: false,
    });
    expect(before.rows[0]?.membership_removed_at).not.toBeNull();

    await asUser(ids.executive, () =>
      db.query(
        `select public.create_invitation(
          'removed.member@example.test', '${invitationToken}', 'employee'
        )`,
      ),
    );

    const accepted = await asUser(ids.removedUser, () =>
      db.query<{ accept_invitation: boolean }>(
        `select public.accept_invitation('${invitationToken}')`,
      ),
    );
    expect(accepted.rows[0]?.accept_invitation).toBe(true);

    const afterAcceptance = await db.query<{
      access_revoked_at: string | null;
      membership_removed_at: string | null;
      is_active_member: boolean;
    }>(
      `select access_revoked_at, membership_removed_at,
        public.is_active_member(id) as is_active_member
      from public.profiles where id = $1`,
      [ids.removedUser],
    );
    expect(afterAcceptance.rows[0]).toEqual({
      access_revoked_at: null,
      membership_removed_at: null,
      is_active_member: true,
    });
    const roles = await db.query<{ role: string }>(
      "select role from public.user_roles where user_id = $1",
      [ids.removedUser],
    );
    expect(roles.rows).toEqual([{ role: "employee" }]);

    await expect(
      asUser(ids.executive, () =>
        db.query(
          `select public.create_invitation(
            'recover.creator@example.test', '${"9".repeat(64)}', 'creator'
          )`,
        ),
      ),
    ).rejects.toThrow(/access was revoked/i);
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

    const deleted = await asUser(ids.executive, () =>
      db.query<{ revoke_invitation: boolean }>("select public.revoke_invitation($1)", [inviteId]),
    );
    expect(deleted.rows[0]?.revoke_invitation).toBe(true);
    const revokedStatus = await db.query<{ get_invitation_status: { status: string } }>(
      `select public.get_invitation_status('${validToken}')`,
    );
    expect(revokedStatus.rows[0]?.get_invitation_status.status).toBe("invalid");
    const remaining = await db.query<{ count: string }>(
      "select count(*)::text as count from public.invitations where token_hash = $1",
      [validToken],
    );
    expect(remaining.rows).toEqual([{ count: "0" }]);
    await expect(
      asUser(ids.invitedUser, () =>
        db.query<{ accept_invitation: boolean }>(
          `select public.accept_invitation('${validToken}')`,
        ),
      ),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it("removes membership without deleting identity/history and allows a normal reinvitation", async () => {
    const invitationToken = "1".repeat(64);
    await db.query("delete from public.user_roles where user_id = $1", [ids.removableUser]);
    await db.query("update public.profiles set access_revoked_at = now() where id = $1", [
      ids.removableUser,
    ]);
    const removal = await asUser(ids.executive, () =>
      db.query<{ remove_team_member: boolean }>("select public.remove_team_member($1)", [
        ids.removableUser,
      ]),
    );
    expect(removal.rows[0]?.remove_team_member).toBe(true);

    const removed = await db.query<{
      auth_identity: boolean;
      profile: boolean;
      access_revoked_at: string | null;
      membership_removed_at: string | null;
    }>(
      `select exists(select 1 from auth.users where id = p.id) as auth_identity,
        true as profile, p.access_revoked_at, p.membership_removed_at
       from public.profiles p where p.id = $1`,
      [ids.removableUser],
    );
    expect(removed.rows[0]).toMatchObject({
      auth_identity: true,
      profile: true,
      access_revoked_at: null,
    });
    expect(removed.rows[0]?.membership_removed_at).not.toBeNull();

    await asUser(ids.executive, () =>
      db.query(
        `select public.create_invitation(
          'remove.member@example.test', '${invitationToken}', 'employee'
        )`,
      ),
    );
    const accepted = await asUser(ids.removableUser, () =>
      db.query<{ complete_pending_invitation: boolean }>(
        "select public.complete_pending_invitation()",
      ),
    );
    expect(accepted.rows[0]?.complete_pending_invitation).toBe(true);

    const active = await db.query<{ is_active_member: boolean; count: string }>(
      `select public.is_active_member(p.id) as is_active_member,
        (select count(*)::text from public.profiles where id = p.id) as count
       from public.profiles p where p.id = $1`,
      [ids.removableUser],
    );
    expect(active.rows).toEqual([{ is_active_member: true, count: "1" }]);
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
    ).rejects.toThrow(/confirm your email address/i);
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
