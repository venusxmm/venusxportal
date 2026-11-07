import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, supabaseForUser } from "../supabase";
import { agenda, dateSchema, toExecutionJson } from "../tasks";

export default defineTool({
  name: "list_tasks",
  title: "List tasks",
  description: "Task executions for one day (default today, Bogotá), optionally filtered by status or title text.",
  inputSchema: {
    date: dateSchema.optional(),
    status: z.string().optional().describe("todo, in_progress, blocked, review, done, skipped"),
    query: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true },
  handler: async ({ date, status, query, limit }, ctx) => {
    const q = query?.toLowerCase();
    const rows = (await agenda(supabaseForUser(ctx), date))
      .map(toExecutionJson)
      .filter((r) => (!status || r.status === status) && (!q || r.title.toLowerCase().includes(q)))
      .slice(0, limit ?? 100);
    return ok({ tasks: rows });
  },
});
