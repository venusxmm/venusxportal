import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, ok, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_recent_activity",
  title: "Recent activity",
  description: "Latest audit log events visible to you.",
  inputSchema: { limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true },
  handler: async ({ limit }, ctx) => {
    const { data, error } = await supabaseForUser(ctx)
      .from("audit_events")
      .select("id, actor_id, entity, entity_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (error) fail(error.message);
    return ok({ events: (data ?? []).map((e) => ({ ...e })) });
  },
});
