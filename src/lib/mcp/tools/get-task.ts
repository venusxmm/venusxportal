import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, ok, supabaseForUser } from "../supabase";
import { agenda, dateSchema, toExecutionJson } from "../tasks";

export default defineTool({
  name: "get_task",
  title: "Get task",
  description: "A task's configuration, its execution on a date (default today) and its comments.",
  inputSchema: { task_id: z.string().uuid(), date: dateSchema.optional() },
  annotations: { readOnlyHint: true },
  handler: async ({ task_id, date }, ctx) => {
    const sb = supabaseForUser(ctx);
    const { data: task, error } = await sb
      .from("tasks")
      .select("id, title, description, priority, due_date, due_time, owner_id, creator_id, recurrence, weekdays, recurrence_state, visible_to_creator, trashed_at")
      .eq("id", task_id)
      .is("trashed_at", null)
      .maybeSingle();
    if (error) fail(error.message);
    if (!task) fail("Task not found or not visible to you.");
    const { data: comments } = await sb
      .from("task_comments")
      .select("author_id, body, created_at")
      .eq("task_id", task_id)
      .order("created_at")
      .limit(50);
    const execution = (await agenda(sb, date)).find((t) => t.task_id === task_id);
    return ok({
      task: { ...task },
      execution: execution ? toExecutionJson(execution) : null,
      comments: (comments ?? []).map((c) => ({ ...c })),
    });
  },
});
