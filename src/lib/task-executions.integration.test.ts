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
const creatorUser = "00000000-0000-0000-0000-000000000005";
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
 create table public.tasks(id uuid primary key default gen_random_uuid(),title text not null,description text,owner_id uuid,creator_id uuid,visible_to_creator boolean not null default false,priority task_priority default 'medium',status task_status default 'todo',due_date date,due_time time,created_by uuid,created_at timestamptz default now(),completed_at timestamptz,archived_at timestamptz);
 create table creators(id uuid primary key,archived_at timestamptz,user_id uuid);
 create function is_own_creator(uuid) returns boolean language sql stable as $$select exists(select 1 from creators where id=$1 and user_id=auth.uid())$$;
 insert into creators(id,user_id) values('${other}','${creatorUser}');
 create table task_comments(id uuid default gen_random_uuid(),task_id uuid,author_id uuid,body text,created_at timestamptz default now());
 grant usage on schema public,auth to authenticated; grant select,insert,update,delete on tasks,task_comments to authenticated;
 alter table tasks enable row level security; alter table task_comments enable row level security;
 create function is_active_member(uuid) returns boolean language sql as $$select $1 is not null$$;
 create function is_executive() returns boolean language sql stable as $$select auth.uid()='${exec}'::uuid$$;
 insert into tasks(title,owner_id,due_date) values('Existing preserved','${owner}','2026-10-24');`);
  await db.exec(migration);
  await db.exec(guards);
  await db.exec(readFileSync("drizzle/migrations/0026_task_future_revision_editing.sql", "utf8"));
  await db.exec(
    readFileSync("drizzle/migrations/0027_task_board_movement_publication_archive.sql", "utf8"),
  );
  await db.exec(
    readFileSync("drizzle/migrations/0028_task_move_projected_input_guard.sql", "utf8"),
  );
  await db.exec(
    readFileSync("drizzle/migrations/0029_task_occurrence_schedule_independence.sql", "utf8"),
  );
  await db.exec(readFileSync("drizzle/migrations/0031_task_portal_blocks_today_edits_apply.sql", "utf8"));
  await db.exec(`create table if not exists public.audit_events(id uuid default gen_random_uuid(),actor_id uuid,entity text,entity_id uuid,action text,details jsonb,created_at timestamptz default now())`);
  await db.exec(readFileSync("drizzle/migrations/0032_task_trash_lifecycle.sql", "utf8").replaceAll("--> statement-breakpoint", ""));
}, 30000);
afterAll(async () => {
  await db.close();
});
describe("execution security and recurrence SQL", () => {
  it("skipping one date leaves neighbouring dates and the rule intact", async () => {
    const tid = await create({ due_date: "2026-10-25" });
    const eid = (
      await as(owner, "select task_future_action($1,'2026-10-26','request_skip') as id", [tid])
    ).rows[0] as { id: string };
    await as(exec, "select task_execution_action($1,'approve_skip')", [eid.id]);
    for (const d of ["2026-10-27", "2026-10-28"]) {
      const a = await as(owner, `select task_agenda('${d}') as agenda`);
      const mine = (a.rows[0] as { agenda: { task_id: string; scheduled_date: string; status: string }[] }).agenda.filter(
        (e) => e.task_id === tid && e.scheduled_date === d,
      );
      expect(mine).toEqual([expect.objectContaining({ status: "todo" })]);
    }
    const skipped = await as(owner, "select task_agenda('2026-10-26') as agenda");
    expect(
      (skipped.rows[0] as { agenda: { task_id: string; status: string; scheduled_date: string }[] }).agenda.filter(
        (e) => e.task_id === tid && e.scheduled_date === "2026-10-26",
      ),
    ).toEqual([expect.objectContaining({ status: "skipped" })]);
    expect((await db.query("select recurrence_state from tasks where id=$1", [tid])).rows).toEqual([
      { recurrence_state: "enabled" },
    ]);
  });
  it("deleting one future date leaves the next date", async () => {
    const tid = await create({});
    await as(owner, "select task_future_action($1,'2026-10-29','archive')", [tid]);
    const gone = await as(owner, "select task_agenda('2026-10-29') as agenda");
    const next = await as(owner, "select task_agenda('2026-10-30') as agenda");
    const has = (r: typeof gone, d: string) =>
      (r.rows[0] as { agenda: { task_id: string; scheduled_date: string }[] }).agenda.some(
        (e) => e.task_id === tid && e.scheduled_date === d,
      );
    expect(has(gone, "2026-10-29")).toBe(false);
    expect(has(next, "2026-10-30")).toBe(true);
  });
  it("rejects publishing when the owner is not the linked creator", async () => {
    await expect(create({ creator_id: other, visible_to_creator: true })).rejects.toThrow(
      "Portal publishing requires",
    );
    await expect(create({ owner_id: creatorUser, creator_id: null })).rejects.toThrow(
      "creator owner must be the linked creator",
    );
  });
  it("creator portal range returns only own published future dates", async () => {
    const pub = await create({ owner_id: creatorUser, creator_id: other, visible_to_creator: true });
    const priv = await create({ owner_id: creatorUser, creator_id: other });
    const r = await as(creatorUser, "select creator_portal_tasks('2026-10-25','2026-10-28') as t");
    const rows = (r.rows[0] as { t: { task_id: string; scheduled_date: string; recurrence: string }[] }).t;
    expect(rows.some((e) => e.task_id === pub && e.scheduled_date === "2026-10-27" && e.recurrence === "daily")).toBe(true);
    expect(rows.some((e) => e.task_id === priv)).toBe(false);
    const o = await as(owner, "select creator_portal_tasks('2026-10-25','2026-10-28') as t");
    expect((o.rows[0] as { t: unknown[] }).t).toEqual([]);
  });
  it("apply_today updates only today's open execution", async () => {
    const tid = await create({ recurrence: "once", due_time: "10:00" });
    await as(exec, "select save_task_configuration($1,$2::jsonb)", [
      tid,
      JSON.stringify({ title: "Isolated QA", owner_id: owner, recurrence: "once", due_date: "2026-10-25", due_time: "15:00", apply_today: true }),
    ]);
    const rows = await db.query(
      "select scheduled_date::text,due_time::text from task_executions where task_id=$1 and status<>'cancelled'",
      [tid],
    );
    expect(rows.rows).toEqual([{ scheduled_date: "2026-10-25", due_time: "15:00:00" }]);
  });
  it("only executives change time blocks", async () => {
    await expect(
      as(owner, "insert into task_time_blocks(label,start_time,end_time) values('X','01:00','02:00')"),
    ).rejects.toThrow();
    expect((await as(owner, "select count(*)::int n from task_time_blocks")).rows).toEqual([{ n: 6 }]);
  });
  it("moving one recurrence date does not suppress either original occurrence", async () => {
    const tid = await create({});
    await as(exec, "select move_task_execution(null,$1,'2026-10-26','20:15','2026-10-27')", [tid]);
    await as(exec, "select move_task_execution(null,$1,'2026-10-27','21:15')", [tid]);
    const rows = await db.query(
      "select occurrence_date::text,scheduled_date::text from task_executions where task_id=$1 and scheduled_date='2026-10-27' order by occurrence_date",
      [tid],
    );
    expect(rows.rows).toEqual([
      { occurrence_date: "2026-10-26", scheduled_date: "2026-10-27" },
      { occurrence_date: "2026-10-27", scheduled_date: "2026-10-27" },
    ]);
    const agenda = await as(owner, "select task_agenda('2026-10-26') as agenda");
    expect(
      (agenda.rows[0] as { agenda: { task_id: string; scheduled_date: string }[] }).agenda.some(
        (e) => e.task_id === tid && e.scheduled_date === "2026-10-26",
      ),
    ).toBe(false);
  });
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
    await as(owner, "select task_agenda('2026-10-25')");
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
  it("linking alone never publishes, explicit publication grants only creator access", async () => {
    const privateId = await create({ recurrence: "once", creator_id: other });
    expect((await as(creatorUser, "select id from tasks where id=$1", [privateId])).rows).toHaveLength(0);
    const published = await create({
      recurrence: "once",
      creator_id: other,
      owner_id: creatorUser,
      visible_to_creator: true,
    });
    const eid = await execution(published, "2026-10-25");
    expect(
      (await as(creatorUser, "select id from task_executions where id=$1", [eid])).rows,
    ).toHaveLength(1);
    await as(creatorUser, "select task_execution_action($1,'complete')", [eid]);
    await expect(
      as(creatorUser, "select save_task_configuration($1,$2::jsonb)", [
        published,
        JSON.stringify({ title: "Hack" }),
      ]),
    ).rejects.toThrow("Executive required");
    await expect(create({ visible_to_creator: true, creator_id: null })).rejects.toThrow(
      "Select a linked creator",
    );
  });
  it("reschedules one execution retaining date, snapshot, and recurrence", async () => {
    const tid = await create({});
    const result = await as(
      exec,
      "select move_task_execution('00000000-0000-0000-0000-000000000000',$1,'2026-10-26','15:05') as id",
      [tid],
    );
    const eid = (result.rows[0] as { id: string }).id;
    await as(exec, "select move_task_execution($1,$2,'2026-10-26','18:05')", [eid, tid]);
    expect(
      (
        await db.query(
          "select scheduled_date::text,occurrence_date::text,due_time::text,description from task_executions where id=$1",
          [eid],
        )
      ).rows,
    ).toEqual([
      {
        scheduled_date: "2026-10-26",
        occurrence_date: "2026-10-26",
        due_time: "18:05:00",
        description: "Original",
      },
    ]);
    await as(owner, "select task_agenda('2026-10-26')");
    expect(
      (
        await db.query(
          "select count(*)::int as n from task_executions where task_id=$1 and occurrence_date='2026-10-26'",
          [tid],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (await db.query("select due_time::text from task_revisions where task_id=$1", [tid])).rows,
    ).toEqual([{ due_time: "09:00:00" }]);
    expect(
      (await db.query("select action from task_execution_events where execution_id=$1", [eid]))
        .rows,
    ).toEqual([{ action: "rescheduled" }, { action: "rescheduled" }]);
    await expect(
      as(owner, "select move_task_execution($1,$2,'2026-10-26','19:00')", [eid, tid]),
    ).rejects.toThrow("Executive required");
  });
  it("blocks collisions and completed execution moves", async () => {
    const a = await create({ recurrence: "once", due_time: "23:01" });
    const b = await create({ recurrence: "once", due_time: "23:02" });
    const eid = await execution(b, "2026-10-25");
    await expect(
      as(exec, "select move_task_execution($1,$2,'2026-10-25','23:01')", [eid, b]),
    ).rejects.toThrow("Time already occupied");
    await as(owner, "select task_execution_action($1,'complete')", [eid]);
    await expect(
      as(exec, "select move_task_execution($1,$2,'2026-10-25','22:00')", [eid, b]),
    ).rejects.toThrow("Execution cannot be moved");
    expect(a).not.toBe(b);
  });
  it("requires exact confirmation and archives completed executions without deleting history or recurrence", async () => {
    const a = await create({}),
      b = await create({});
    await as(owner, "select task_agenda('2026-10-25')");
    const ea = await execution(a, "2026-10-25"),
      eb = await execution(b, "2026-10-25");
    await as(owner, "select task_execution_action($1,'comment','Keep history')", [ea]);
    await as(owner, "select task_execution_action($1,'complete')", [ea]);
    await expect(as(exec, "select archive_task_executions($1,1,true)", [[ea, eb]])).rejects.toThrow(
      "Confirm the exact",
    );
    await expect(as(exec, "select archive_task_executions($1,2,true)", [[ea, eb]])).rejects.toThrow(
      "Selection changed",
    );
    await as(owner, "select task_execution_action($1,'complete')", [eb]);
    await expect(
      as(owner, "select archive_task_executions($1,2,true)", [[ea, eb]]),
    ).rejects.toThrow("Executive required");
    await as(exec, "select archive_task_executions($1,2,true)", [[ea, eb]]);
    expect(
      (
        await db.query(
          "select count(*)::int as n from task_executions where id=any($1) and archived_at is not null",
          [[ea, eb]],
        )
      ).rows,
    ).toEqual([{ n: 2 }]);
    const future = await as(owner, "select task_agenda('2026-10-26') as agenda");
    expect(
      (future.rows[0] as { agenda: { task_id: string; scheduled_date: string }[] }).agenda.some(
        (e) => e.task_id === a && e.scheduled_date === "2026-10-26",
      ),
    ).toBe(true);
    const today = await as(owner, "select task_agenda('2026-10-25') as agenda");
    expect((today.rows[0] as { agenda: { id: string }[] }).agenda.some((e) => e.id === ea)).toBe(
      false,
    );
    expect(
      (
        await db.query(
          "select body from task_execution_events where execution_id=$1 and action='comment'",
          [ea],
        )
      ).rows,
    ).toEqual([{ body: "Keep history" }]);
  });
  it("allows owner single archival but rejects cross-owner archival", async () => {
    const tid = await create({ recurrence: "once" });
    const eid = await execution(tid, "2026-10-25");
    await expect(as(other, "select archive_task_executions($1,1,false)", [[eid]])).rejects.toThrow(
      "Not authorized",
    );
    await as(owner, "select archive_task_executions($1,1,false)", [[eid]]);
    expect(
      (
        await db.query(
          "select archived_at is not null as archived from task_executions where id=$1",
          [eid],
        )
      ).rows,
    ).toEqual([{ archived: true }]);
  });
});
describe("trash lifecycle", () => {
  const portal = async (d1: string, d2: string) =>
    (
      (await as(creatorUser, `select creator_portal_tasks('${d1}','${d2}') as t`)).rows[0] as {
        t: { task_id: string; scheduled_date: string }[];
      }
    ).t;
  const agenda = async (user: string, d: string) =>
    (
      (await as(user, `select task_agenda('${d}') as a`)).rows[0] as {
        a: { task_id: string; scheduled_date: string; status: string }[];
      }
    ).a;
  it("published series disappears from portal and agenda when trashed, and returns on restore without duplicates", async () => {
    const tid = await create({ owner_id: creatorUser, creator_id: other, visible_to_creator: true });
    expect((await portal("2026-10-25", "2026-10-28")).some((e) => e.task_id === tid)).toBe(true);
    await as(exec, "select trash_task_series($1)", [tid]);
    expect((await portal("2026-10-25", "2026-10-28")).some((e) => e.task_id === tid)).toBe(false);
    expect((await agenda(exec, "2026-10-27")).some((e) => e.task_id === tid)).toBe(false);
    await as(exec, "select restore_task_series($1)", [tid]);
    await agenda(exec, "2026-10-27");
    const rows = (await portal("2026-10-25", "2026-10-28")).filter((e) => e.task_id === tid);
    const dates = rows.map((r) => r.scheduled_date);
    expect(dates.length).toBe(new Set(dates).size);
    expect(dates).toContain("2026-10-27");
  });
  it("trashing one occurrence keeps other dates; restoring it brings back only that date", async () => {
    const tid = await create({});
    const today = (await db.query<{ d: string }>("select ((now() at time zone 'America/Bogota')::date)::text d")).rows[0]!.d;
    await agenda(exec, today);
    const eid = await execution(tid, today);
    await as(exec, "select archive_task_executions($1::uuid[],1,false)", [[eid]]);
    expect((await agenda(exec, today)).some((e) => e.task_id === tid && e.scheduled_date === today)).toBe(false);
    await as(exec, "select restore_task_executions($1::uuid[],1)", [[eid]]);
    expect((await agenda(exec, today)).filter((e) => e.task_id === tid && e.scheduled_date === today)).toHaveLength(1);
  });
  it("only executives trash, restore or purge, and counts must match", async () => {
    const tid = await create({});
    await expect(as(owner, "select trash_task_series($1)", [tid])).rejects.toThrow("Executive required");
    await as(exec, "select trash_task_series($1)", [tid]);
    await expect(as(owner, "select restore_task_series($1)", [tid])).rejects.toThrow("Executive required");
    await expect(as(owner, "select purge_tasks($1::uuid[],1)", [[tid]])).rejects.toThrow("Executive required");
    await expect(as(exec, "select purge_tasks($1::uuid[],2)", [[tid]])).rejects.toThrow("exact number");
  });
  it("purging a trashed task removes it and all its rows; an untrashed task cannot be purged", async () => {
    const keep = await create({});
    const tid = await create({});
    await as(exec, "select trash_task_series($1)", [tid]);
    await expect(as(exec, "select purge_tasks($1::uuid[],1)", [[keep]])).rejects.toThrow("Only tasks in Trash");
    await as(exec, "select purge_tasks($1::uuid[],1)", [[tid]]);
    for (const t of ["tasks where id", "task_executions where task_id", "task_revisions where task_id"])
      expect((await db.query(`select 1 from ${t}=$1`, [tid])).rows).toHaveLength(0);
    expect((await db.query("select 1 from tasks where id=$1", [keep])).rows).toHaveLength(1);
  });
  it("purging one occurrence of a live series never regenerates that date", async () => {
    const tid = await create({});
    const today = (await db.query<{ d: string }>("select ((now() at time zone 'America/Bogota')::date)::text d")).rows[0]!.d;
    await agenda(exec, today);
    const eid = await execution(tid, today);
    await as(exec, "select archive_task_executions($1::uuid[],1,false)", [[eid]]);
    await as(exec, "select purge_task_executions($1::uuid[],1)", [[eid]]);
    expect((await agenda(exec, today)).some((e) => e.task_id === tid && e.scheduled_date === today)).toBe(false);
    expect((await agenda(exec, shiftDay(today))).some((e) => e.task_id === tid)).toBe(true);
  });
});
function shiftDay(d: string) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

