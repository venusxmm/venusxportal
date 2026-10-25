import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

// Only the Vercel frontend may call this cross-origin; it runs on Lovable hosting,
// where the managed backend secrets exist. The caller's bearer token is verified here.
const ALLOWED_ORIGIN = "https://venusxportal.vercel.app";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};
const body = z.object({ email: z.string().trim().email().max(320), role: z.enum(["executive", "employee", "creator", "partner"]) });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });

export const Route = createFileRoute("/api/public/invitations")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        if (request.headers.get("origin") !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed." }, 403);
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Sign in required." }, 401);
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid email or role." }, 400);

        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !key) return json({ error: "Backend connection unavailable." }, 500);
        const supabase = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: claims, error } = await supabase.auth.getClaims(token);
        if (error || !claims?.claims?.sub) return json({ error: "Sign in required." }, 401);
        try {
          const { runNativeInvitation } = await import("@/lib/invitation-service.server");
          return json(await runNativeInvitation(supabase, parsed.data));
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    },
  },
});
