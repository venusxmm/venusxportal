import { defineTool } from "@lovable.dev/mcp-js";
import { agencyDate } from "@/lib/task-executions";
import { summarize } from "@/lib/finance";
import { ok, supabaseForUser } from "../supabase";
import { agenda, dateSchema, toExecutionJson } from "../tasks";

export default defineTool({
  name: "get_dashboard_summary",
  title: "Dashboard summary",
  description: "Open, overdue and critical task counts for a day plus this month's finance totals when your role allows.",
  inputSchema: { date: dateSchema.optional() },
  annotations: { readOnlyHint: true },
  handler: async ({ date }, ctx) => {
    const sb = supabaseForUser(ctx);
    const day = date ?? agencyDate();
    const rows = (await agenda(sb, day)).map(toExecutionJson);
    const open = rows.filter((r) => !["done", "skipped", "cancelled"].includes(r.status));
    const month = day.slice(0, 7);
    const { data: tx } = await sb
      .from("transactions")
      .select("kind, amount, currency, agency_share_pct, deduct_from_agency_cut, archived_at, occurred_on, creator_id")
      .gte("occurred_on", `${month}-01`)
      .lte("occurred_on", `${month}-31`)
      .is("archived_at", null)
      .limit(5000);
    const finance = (tx ?? []).length ? summarize(tx as never) : [];
    return ok({
      date: day,
      tasks: {
        total: rows.length,
        open: open.length,
        overdue: open.filter((r) => r.overdue).length,
        critical: open.filter((r) => r.priority === "critical").length,
        completed: rows.filter((r) => r.status === "done").length,
      },
      finance_month: month,
      finance: JSON.parse(JSON.stringify(finance)) as Record<string, unknown>[],
    });
  },
});
