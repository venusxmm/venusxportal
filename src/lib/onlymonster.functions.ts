import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertExec(supabase: { rpc: (n: "is_executive") => PromiseLike<{ data: unknown; error: unknown }> }) {
  const { data, error } = await supabase.rpc("is_executive");
  if (error || data !== true) throw new Error("Forbidden: executives only.");
}

export const syncOnlyMonster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertExec(context.supabase as never);
    const { runSync } = await import("./onlymonster.server");
    return runSync("manual", context.userId);
  });

export const refreshOmAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertExec(context.supabase as never);
    const { refreshAccounts } = await import("./onlymonster.server");
    try {
      return { ok: true as const, count: await refreshAccounts() };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const mapOmAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().min(1).max(40),
        creator_id: z.string().uuid().nullable(),
        agency_share_pct: z.number().min(0).max(100).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertExec(context.supabase as never);
    // RLS (is_executive) enforces this update as the caller.
    const { error } = await context.supabase
      .from("onlymonster_accounts")
      .update({ creator_id: data.creator_id, agency_share_pct: data.agency_share_pct, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
