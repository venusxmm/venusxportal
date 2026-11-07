import { createClient } from "@supabase/supabase-js";
import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";

type RuntimeGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

function env(names: string[]): string | undefined {
  const e = (globalThis as RuntimeGlobals).process?.env ?? {};
  for (const n of names) {
    const v = e[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!ctx.isAuthenticated() || !token) throw new ToolError("Not authenticated");
  const url = env(["SUPABASE_URL", "VITE_SUPABASE_URL"]) ?? import.meta.env["VITE_SUPABASE_URL"];
  const key =
    env(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) ??
    import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new ToolError("Backend configuration missing");
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function fail(message: string): never {
  throw new ToolError(message);
}

export function ok<T extends Record<string, unknown>>(data: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}
