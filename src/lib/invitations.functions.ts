import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deliverInvitationEmail, INVITATION_REDIRECT } from "./native-invitation";

/**
 * Executive-only: registers (or reuses the single pending) invitation, then sends the
 * native Auth email. A failed send keeps the invitation pending with status "failed"
 * so it can be resent or cancelled explicitly; nothing is auto-revoked.
 */
export const sendNativeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ email: z.string().trim().email(), role: z.enum(["executive", "employee", "creator", "partner"]) }))
  .handler(async ({ data, context }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("is_executive");
    if (roleError || !allowed) throw new Error("Only executives can send invitations.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();

    const { data: pending, error: pendingError } = await context.supabase
      .from("invitations")
      .select("id,role")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (pendingError) throw new Error("Could not check existing invitations.");
    if (pending && pending.role !== data.role) {
      throw new Error(`A pending ${pending.role} invitation already exists for this email. Cancel it before inviting with another role.`);
    }

    let id = pending?.id;
    if (!id) {
      // The registry token is an opaque fingerprint; only native Auth tokens travel by email.
      const digest = await crypto.subtle.digest("SHA-256", crypto.getRandomValues(new Uint8Array(32)));
      const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      const { data: row, error } = await context.supabase.rpc("create_invitation", {
        _email: email, _role: data.role, _areas: [], _token_hash: fingerprint,
      });
      if (error) throw new Error(error.message);
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row["id"] !== "string") {
        throw new Error("Invitation registration could not be confirmed. No email sent.");
      }
      id = row["id"];
    }

    const result = await deliverInvitationEmail(
      async () => (await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo: INVITATION_REDIRECT })).error,
      async () => (await supabaseAdmin.auth.signInWithOtp({
        email, options: { shouldCreateUser: false, emailRedirectTo: INVITATION_REDIRECT },
      })).error,
    );
    const { error: trackError } = await supabaseAdmin.from("invitations").update({
      delivery_status: result.status,
      delivery_method: result.method,
      delivery_error: result.status === "failed" ? result.error.slice(0, 300) : null,
      last_sent_at: result.status === "sent" ? new Date().toISOString() : undefined,
    }).eq("id", id);
    if (trackError) console.error("invitation delivery tracking failed", trackError.message);
    return { id, resent: !!pending, ...result };
  });
