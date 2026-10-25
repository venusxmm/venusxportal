import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Executive-only native invitation (same-origin path). Logic lives in invitation-service.server. */
export const sendNativeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().trim().email(), role: z.enum(["executive", "employee", "creator", "partner"]) }))
  .handler(async ({ data, context }) => {
    const { runNativeInvitation } = await import("./invitation-service.server");
    return runNativeInvitation(context.supabase, data);
  });
