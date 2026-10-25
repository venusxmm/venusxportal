// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const migration = readFileSync(
  "drizzle/migrations/0024_task_executions_owner_security.sql",
  "utf8",
);
const guards = readFileSync(
  "drizzle/migrations/0025_task_execution_configuration_guards.sql",
  "utf8",
);
let db: PGlite;
const exec = "00000000-0000-0000-0000-000000000001";
const owner = "00000000-0000-0000-0000-000000000002";
const other = "00000000-0000-0000-0000-000000000003";
async function as(user: string, sql: string, args: unknown[] = []) {
  await db.exec(
    `begin; select set_config('request.jwt.claim.sub','${user}',true); set local role authenticated`,
  );
  try {
    const result = await db.query(sql, args);
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
async function create(config: Record<string, unknown>) {
  const r = await as(exec, `select public.save_task_configuration(null,$1::jsonb) as id`, [
    JSON.stringify({
      title: "Isolated QA",
      description: "Original",
      owner_id: owner,
      due_date: "2026-10-25",
      due_time: "09:00",
      recurrence: "daily",
      weekdays: [],
      ...config,
    }),
  ]);
  return (r.rows[0] as { id: string }).id;
}
async function execution(tid: string, date: string) {
  const r = await db.query<{ id: string }>(
    `select id from task_executions where task_id=$1 and scheduled_date=$2 and status<>'cancelled'`,
    [tid, date],
  );
  const row = r.rows[0];
  if (!row) throw Error("Missing execution");
  return row.id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create type public.task_priority as enum('low','medium','high','critical'); create type public.task_status as enum('todo','in_progress','blocked','review','done');
 create table public.tasks(id uuid primary key default gen_random_uuid(),title text not null,description text,owner_id uuid,creator_id uuid,priority task_priority default 'medium',status task_status default 'todo',due_date date,due_time time,created_by uuid,created_at timestamptz default now(),completed_at timestamptz,archived_at timestamptz);
 create table task_comments(id uuid default gen_random_uuid(),task_id uuid,author_id uuid,body text,created_at timestamptz default now());
 grant usage on schema public,auth to authenticated; grant select,insert,update,delete on tasks,task_comments to authenticated;
 alter table tasks enable row level security; alter table task_comments enable row level security;
 create function is_active_member(uuid) returns boolean language sql as $$select $1 is not null$$;
 create function is_executive() returns boolean language sql stable as $$select auth.uid()='${exec}'::uuid$$;
 insert into tasks(title,owner_id,due_date) values('Existing preserved','${owner}','2026-10-24');`);
  await db.exec(migration);
  await db.exec(guards);
  await db.exec(readFileSync("drizzle/migrations/0026_task_future_revision_editing.sql", "utf8"));
}, 30000);
afterAll(async () => {
  await db.close();
});
describe("execution security and recurrence SQL", () => {
  it("preserves existing tasks and backs up execution snapshots", async () => {
    const r = await db.query(
      `select e.title,e.scheduled_date::text from task_executions e join tasks t on t.id=e.task_id where t.title='Existing preserved'`,
    );
    expect(r.rows).toEqual([{ title: "Existing preserved", scheduled_date: "2026-10-24" }]);
  });
  it.each(["employee", "creator", "partner"])(
    "restricts %s-style owner access and denies configuration edits",
    async () => {
      const tid = await create({ recurrence: "once", due_date: "2026-10-24" });
      expect((await as(owner, "select id from tasks where id=$1", [tid])).rows).toHaveLength(1);
      expect((await as(other, "select id from tasks where id=$1", [tid])).rows).toHaveLength(0);
      expect(
        (await as(owner, "update tasks set title='Hacked' where id=$1 returning id", [tid])).rows,
      ).toHaveLength(0);
      await expect(
        as(owner, "select save_task_configuration($1,$2::jsonb)", [
          tid,
          JSON.stringify({ title: "Hacked" }),
        ]),
      ).rejects.toThrow("Executive required");
    },
  );
  it("unassigned executions are executive-only", async () => {
    const tid = await create({ owner_id: null, recurrence: "once" });
    const eid = await execution(tid, "2026-10-25");
    expect(
      (await as(owner, "select id from task_executions where id=$1", [eid])).rows,
    ).toHaveLength(0);
    await expect(as(owner, "select task_execution_action($1,'complete')", [eid])).rejects.toThrow(
      "Not authorized",
    );
  });
  it("daily executions are independent and duplicate-safe", async () => {
    const tid = await create({ due_date: "2026-10-24" });
    await as(owner, "select task_agenda('2026-10-25')");
    await as(owner, "select task_agenda('2026-10-25')");
    // New recurring schedules begin today, not retroactively.
    const eid = await execution(tid, "2026-10-25");
    await as(owner, "select task_execution_action($1,'complete')", [eid]);
    expect(
      (await db.query("select count(*)::int as n from task_executions where task_id=$1", [tid]))
        .rows,
    ).toEqual([{ n: 1 }]);
    const future = await as(owner, "select task_agenda('2026-10-26') as agenda");
    expect(
      (future.rows[0] as { agenda: { task_id: string; status: string }[] }).agenda.find(
        (e) => e.task_id === tid,
      )?.status,
    ).toBe("todo");
  });
  it("preserves original completion and reopening events", async () => {
    const tid = await create({ recurrence: "once" });
    const eid = await execution(tid, "2026-10-25");
    await as(owner, "select task_execution_action($1,'complete')", [eid]);
    await as(owner, "select task_execution_action($1,'reopen')", [eid]);
    const r = await db.query(
      "select status,completed_at is not null as retained from task_executions where id=$1",
      [eid],
    );
    expect(r.rows).toEqual([{ status: "todo", retained: true }]);
    expect(
      (
        await db.query(
          "select action from task_execution_events where execution_id=$1 order by created_at",
          [eid],
        )
      ).rows,
    ).toEqual([{ action: "complete" }, { action: "reopen" }]);
  });
  it("requires executive skip approval and retains recurrence", async () => {
    const tid = await create({});
    await as(owner, "select task_agenda('2026-10-25')");
    const eid = await execution(tid, "2026-10-25");
    await as(owner, "select task_execution_action($1,'request_skip','Optional reason')", [eid]);
    await expect(
      as(owner, "select task_execution_action($1,'approve_skip')", [eid]),
    ).rejects.toThrow("Executive approval required");
    await as(exec, "select task_execution_action($1,'reject_skip')", [eid]);
    await as(owner, "select task_execution_action($1,'request_skip')", [eid]);
    await as(exec, "select task_execution_action($1,'approve_skip')", [eid]);
    expect((await db.query("select status from task_executions where id=$1", [eid])).rows).toEqual([
      { status: "skipped" },
    ]);
    expect((await db.query("select recurrence_state from tasks where id=$1", [tid])).rows).toEqual([
      { recurrence_state: "enabled" },
    ]);
  });
  it("edits/reassigns/pauses only future executions and preserves today snapshots", async () => {
    const tid = await create({});
    await as(owner, "select task_agenda('2026-10-25')");
    await as(exec, "select save_task_configuration($1,$2::jsonb)", [
      tid,
      JSON.stringify({
        title: "Updated",
        description: "New instructions",
        owner_id: other,
        recurrence: "daily",
        due_date: "2026-10-25",
        recurrence_state: "paused",
      }),
    ]);
    const r = await db.query(
      "select title,description,owner_id from task_executions where task_id=$1",
      [tid],
    );
    expect(r.rows).toEqual([{ title: "Isolated QA", description: "Original", owner_id: owner }]);
    const r2 = await as(other, "select task_agenda('2026-10-26') as agenda");
    expect(
      (r2.rows[0] as { agenda: { task_id: string }[] }).agenda.some((e) => e.task_id === tid),
    ).toBe(false);
  });
  it("selected weekdays apply only on applicable dates", async () => {
    const tid = await create({ recurrence: "weekdays", weekdays: [1, 3] });
    const a = await as(owner, "select task_agenda('2026-10-26') as agenda");
    const b = await as(owner, "select task_agenda('2026-10-27') as agenda");
    expect(
      (a.rows[0] as { agenda: { task_id: string }[] }).agenda.some((e) => e.task_id === tid),
    ).toBe(true);
    expect(
      (b.rows[0] as { agenda: { task_id: string }[] }).agenda.some((e) => e.task_id === tid),
    ).toBe(false);
  });
  it("keeps today's one-time snapshot when the executive edits future instructions", async () => {
    const tid = await create({ recurrence: "once" });
    await as(exec, "select save_task_configuration($1,$2::jsonb)", [
      tid,
      JSON.stringify({
        title: "Future instructions",
        description: "New",
        owner_id: other,
        recurrence: "once",
        due_date: "2026-10-25",
      }),
    ]);
    const rows = await db.query(
      "select title,description,owner_id,scheduled_date::text from task_executions where task_id=$1 order by scheduled_date",
      [tid],
    );
    expect(rows.rows).toEqual([
      {
        title: "Isolated QA",
        description: "Original",
        owner_id: owner,
        scheduled_date: "2026-10-25",
      },
      {
        title: "Future instructions",
        description: "New",
        owner_id: other,
        scheduled_date: "2026-10-26",
      },
    ]);
  });
  it("rejects a skip request without stopping the next daily execution", async () => {
    const tid = await create({});
    const eid = await execution(tid, "2026-10-25");
    await as(owner, "select task_execution_action($1,'request_skip')", [eid]);
    await as(exec, "select task_execution_action($1,'reject_skip')", [eid]);
    expect(
      (await db.query("select status,skip_state from task_executions where id=$1", [eid])).rows,
    ).toEqual([{ status: "todo", skip_state: "rejected" }]);
    const next = await as(owner, "select task_agenda('2026-10-26') as agenda");
    expect(
      (next.rows[0] as { agenda: { task_id: string; scheduled_date: string }[] }).agenda.some(
        (e) => e.task_id === tid && e.scheduled_date === "2026-10-26",
      ),
    ).toBe(true);
  });
  it("comments and execution updates cannot cross owner boundaries", async () => {
    const tid = await create({ recurrence: "once" });
    const eid = await execution(tid, "2026-10-25");
    await expect(
      as(other, "select task_execution_action($1,'comment','Intrusion')", [eid]),
    ).rejects.toThrow("Not authorized");
    await as(owner, "select task_execution_action($1,'comment','Owner comment')", [eid]);
    expect(
      (await as(other, "select id from task_execution_events where execution_id=$1", [eid])).rows,
    ).toHaveLength(0);
    expect(
      (await as(owner, "select body from task_execution_events where execution_id=$1", [eid])).rows,
    ).toEqual([{ body: "Owner comment" }]);
    await expect(
      as(owner, "update task_executions set description='Hacked' where id=$1", [eid]),
    ).rejects.toThrow(/permission denied/);
  });
  it("supports the new-task sentinel used by the UI", async () => {
    const r = await as(
      exec,
      "select save_task_configuration('00000000-0000-0000-0000-000000000000',$1::jsonb) as id",
      [JSON.stringify({ title: "UI new task", recurrence: "once", due_date: "2026-10-25" })],
    );
    expect((r.rows[0] as { id: string }).id).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("allows future skip requests without duplicate projected executions", async () => {
    const tid = await create({});
    const r = await as(
      owner,
      "select task_future_action($1,'2026-10-26','request_skip','Away') as id",
      [tid],
    );
    const eid = (r.rows[0] as { id: string }).id;
    const agenda = await as(owner, "select task_agenda('2026-10-26') as agenda");
    expect(
      (agenda.rows[0] as { agenda: { task_id: string; scheduled_date: string }[] }).agenda.filter(
        (e) => e.task_id === tid && e.scheduled_date === "2026-10-26",
      ),
    ).toHaveLength(1);
    await as(exec, "select task_execution_action($1,'approve_skip')", [eid]);
    expect((await db.query("select status from task_executions where id=$1", [eid])).rows).toEqual([
      { status: "skipped" },
    ]);
  });
});
