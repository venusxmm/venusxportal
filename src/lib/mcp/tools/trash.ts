import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, ok, supabaseForUser } from "../supabase";
import { agenda, dateSchema } from "../tasks";

// All rules (executive/owner, counts, confirmations) are enforced by the same RPCs the Tasks screen uses.
async function executionId(sb: ReturnType<typeof supabaseForUser>, taskId: string, date: string) {
  const row = (await agenda(sb, date)).find((t) => t.task_id === taskId && t.scheduled_date === date);
  if (!row) fail("No execution of this task on that date is visible to you.");
  if (!row.projected) return row.id;
  const { data, error } = await sb.rpc("task_resolve_execution", { _task_id: taskId, _date: date });
  if (error) fail(error.message);
  return data as string;
}

export const trashTask = defineTool({
  name: "trash_task",
  title: "Move task to Trash",
  description: "Soft-delete one dated occurrence (scope=occurrence) or the whole task/series (scope=series). Reversible via restore_task. Requires confirm=true.",
  inputSchema: {
    task_id: z.string().uuid(),
    scope: z.enum(["occurrence", "series"]),
    date: dateSchema.optional().describe("Required for scope=occurrence"),
    confirm: z.literal(true).describe("Must be true to confirm"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  handler: async ({ task_id, scope, date }, ctx) => {
    const sb = supabaseForUser(ctx);
    if (scope === "series") {
      const { data, error } = await sb.rpc("trash_task_series", { _task_id: task_id });
      if (error) fail(error.message);
      return ok({ trashed: "series", task_id, affected: data ?? 0 });
    }
    if (!date) fail("date is required for scope=occurrence");
    const id = await executionId(sb, task_id, date!);
    const { error } = await sb.rpc("archive_task_executions", { _ids: [id], _confirm_count: 1 });
    if (error) fail(error.message);
    return ok({ trashed: "occurrence", task_id, date: date!, execution_id: id });
  },
});

export const listTrash = defineTool({
  name: "list_trash",
  title: "List Trash",
  description: "List task occurrences and series currently in Trash that you can see.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
  handler: async (_a, ctx) => {
    const sb = supabaseForUser(ctx);
    const [ex, se] = await Promise.all([
      sb.from("task_executions").select("id,task_id,title,scheduled_date,due_time,archived_at")
        .not("archived_at", "is", null).is("purged_at", null).order("archived_at", { ascending: false }).limit(200),
      sb.from("tasks").select("id,title,recurrence,trashed_at").not("trashed_at", "is", null).limit(200),
    ]);
    if (ex.error) fail(ex.error.message);
    if (se.error) fail(se.error.message);
    return ok({
      occurrences: (ex.data ?? []).map((r) => ({ execution_id: r.id, task_id: r.task_id, title: r.title, date: r.scheduled_date, time: r.due_time, trashed_at: r.archived_at })),
      series: (se.data ?? []).map((r) => ({ task_id: r.id, title: r.title, recurrence: r.recurrence, trashed_at: r.trashed_at })),
    });
  },
});

export const restoreTask = defineTool({
  name: "restore_task",
  title: "Restore task from Trash",
  description: "Restore a trashed occurrence (execution_id) or a trashed series (task_id).",
  inputSchema: { execution_id: z.string().uuid().optional(), task_id: z.string().uuid().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ execution_id, task_id }, ctx) => {
    const sb = supabaseForUser(ctx);
    if (!execution_id && !task_id) fail("Provide execution_id or task_id");
    const { data, error } = execution_id
      ? await sb.rpc("restore_task_executions", { _ids: [execution_id], _confirm_count: 1 })
      : await sb.rpc("restore_task_series", { _task_id: task_id! });
    if (error) fail(error.message);
    return ok({ restored: data ?? 0 });
  },
});

export const reorderTasks = defineTool({
  name: "reorder_tasks",
  title: "Reorder tasks",
  description: "Set the manual order of tasks on one date. Pass task_ids top-to-bottom; order is independent of time.",
  inputSchema: { date: dateSchema, task_ids: z.array(z.string().uuid()).min(1).max(200) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ date, task_ids }, ctx) => {
    const sb = supabaseForUser(ctx);
    const ids: string[] = [];
    for (const t of task_ids) ids.push(await executionId(sb, t, date));
    const { error } = await sb.rpc("reorder_task_executions", { _ids: ids });
    if (error) fail(error.message);
    return ok({ reordered: ids.length, date });
  },
});

export const placeTask = defineTool({
  name: "place_task",
  title: "Move task to block / position",
  description: "Place one task occurrence (task_id + date) in a time block (name or id), before another task or at the end. Never changes its time or date.",
  inputSchema: {
    task_id: z.string().uuid(),
    date: dateSchema,
    block: z.string().min(1).describe("Block name (e.g. Morning) or block id."),
    before_task_id: z.string().uuid().optional().describe("Place above this task; omit to place last."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ task_id, date, block, before_task_id }, ctx) => {
    const sb = supabaseForUser(ctx);
    const { data: blocks, error: be } = await sb.from("task_time_blocks").select("id,label");
    if (be) fail(be.message);
    const b = (blocks ?? []).find((x) => x.id === block || x.label.toLowerCase() === block.toLowerCase());
    if (!b) fail(`Unknown block. Use one of: ${(blocks ?? []).map((x) => x.label).join(", ")}`);
    const eid = await executionId(sb, task_id, date);
    const before = before_task_id ? await executionId(sb, before_task_id, date) : undefined;
    const { error } = await sb.rpc("place_task_execution", {
      _id: eid, _task_id: task_id, _occurrence_date: date, _block_id: b!.id, ...(before ? { _before_id: before } : {}),
    });
    if (error) fail(error.message);
    return ok({ placed: eid, block: b!.label, date });
  },
});
