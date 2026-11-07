import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { agencyDate } from "@/lib/task-executions";
import { ok, supabaseForUser } from "../supabase";
import { saveConfig, taskFields } from "../tasks";

export default defineTool({
  name: "create_task",
  title: "Create task",
  description: "Create a task (Executives only, enforced by the portal).",
  inputSchema: { ...taskFields, title: z.string().min(1).max(200) },
  annotations: { readOnlyHint: false, destructiveHint: false },
  handler: async (a, ctx) => {
    const id = await saveConfig(supabaseForUser(ctx), null, {
      title: a.title,
      description: a.description ?? "",
      owner_id: a.owner_id ?? "",
      creator_id: a.creator_id ?? "",
      priority: a.priority ?? "medium",
      due_date: a.due_date === undefined ? agencyDate() : (a.due_date ?? ""),
      due_time: a.due_time ?? "",
      recurrence: a.recurrence ?? "once",
      weekdays: a.weekdays ?? [1, 2, 3, 4, 5],
      recurrence_state: "enabled",
      visible_to_creator: a.visible_to_creator ?? false,
    });
    return ok({ created: true, task_id: id });
  },
});
