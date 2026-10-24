import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deliverRegisteredInvitation, INVITATION_REDIRECT } from "./native-invitation";

export const sendNativeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().trim().email(), role: z.enum(["executive", "employee", "creator", "partner"]) }))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_executive");
    if (roleError || !allowed) throw new Error("Only executives can send invitations.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    // Retain the existing invitation registry; only native Auth tokens travel by email.
    const random = crypto.getRandomValues(new Uint8Array(32));
    const digest = await crypto.subtle.digest("SHA-256", random);
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    return deliverRegisteredInvitation(
      async () => {
        const { data: row, error } = await context.supabase.rpc("create_invitation", {
          _email: email, _role: data.role, _areas: [], _token_hash: fingerprint,
        });
        if (error) throw new Error(error.message);
        if (!row || typeof row !== "object" || Array.isArray(row) || typeof row["id"] !== "string") {
          throw new Error("Invitation registration could not be confirmed. No email sent.");
        }
        return row["id"];
      },
      async () => {
        const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo: INVITATION_REDIRECT });
        if (error) throw new Error("Native invitation sending failed.");
      },
      async id => {
        const { error } = await context.supabase.rpc("revoke_invitation", { _id: id });
        if (error) throw new Error("Invitation revocation failed.");
      },
    );
  });