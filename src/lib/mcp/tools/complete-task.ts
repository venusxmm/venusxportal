import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, supabaseForUser } from "../supabase";
import { dateSchema, executionAction } from "../tasks";

export const completeTask = defineTool({
  name: "complete_task",
  title: "Complete task",
  description: "Mark one dated execution of a task as completed (only that date).",
  inputSchema: { task_id: z.string().uuid(), date: dateSchema },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ task_id, date }, ctx) => {
    await executionAction(supabaseForUser(ctx), task_id, date, "complete");
    return ok({ completed: true, task_id, date });
  },
});

export const reopenTask = defineTool({
  name: "reopen_task",
  title: "Reopen task",
  description: "Undo completion of one dated execution of a task.",
  inputSchema: { task_id: z.string().uuid(), date: dateSchema },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ task_id, date }, ctx) => {
    await executionAction(supabaseForUser(ctx), task_id, date, "reopen");
    return ok({ reopened: true, task_id, date });
  },
});
