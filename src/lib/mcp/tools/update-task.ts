import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, ok, supabaseForUser } from "../supabase";
import { saveConfig, taskFields } from "../tasks";

export default defineTool({
  name: "update_task",
  title: "Update task",
  description: "Edit a task's configuration; only given fields change (Executives only, enforced by the portal).",
  inputSchema: { task_id: z.string().uuid(), ...taskFields },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ task_id, ...a }, ctx) => {
    const sb = supabaseForUser(ctx);
    const { data: t, error } = await sb.from("tasks").select("*").eq("id", task_id).is("trashed_at", null).maybeSingle();
    if (error) fail(error.message);
    if (!t) fail("Task not found or not visible to you.");
    const pick = <T,>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
    await saveConfig(sb, task_id, {
      title: pick(a.title, t.title),
      description: pick(a.description, t.description ?? ""),
      owner_id: pick(a.owner_id, t.owner_id) ?? "",
      creator_id: pick(a.creator_id, t.creator_id) ?? "",
      priority: pick(a.priority, t.priority),
      due_date: pick(a.due_date, t.due_date) ?? "",
      due_time: pick(a.due_time, t.due_time?.slice(0, 5) ?? null) ?? "",
      recurrence: pick(a.recurrence, t.recurrence),
      weekdays: pick(a.weekdays, t.weekdays),
      recurrence_state: t.recurrence_state,
      visible_to_creator: pick(a.visible_to_creator, t.visible_to_creator),
    });
    return ok({ updated: true, task_id });
  },
});
