import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { deliverInvitationEmail, INVITATION_REDIRECT } from "./native-invitation";

export type InvitationRole = "executive" | "employee" | "creator" | "partner";
export const INVITATION_ROLES: InvitationRole[] = ["executive", "employee", "creator", "partner"];

/**
 * Executive-only: registers (or reuses the single pending) invitation, then sends the
 * native Auth email. `supabase` must be the caller's RLS-scoped client. A failed send keeps
 * the invitation pending with status "failed"; nothing is auto-revoked.
 */
export async function runNativeInvitation(
  supabase: SupabaseClient<Database>,
  data: { email: string; role: InvitationRole },
) {
  const { data: allowed, error: roleError } = await supabase.rpc("is_executive");
  if (roleError || !allowed) throw new Error("Only executives can send invitations.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = data.email.trim().toLowerCase();

  const { data: pending, error: pendingError } = await supabase
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
    const digest = await crypto.subtle.digest("SHA-256", crypto.getRandomValues(new Uint8Array(32)));
    const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const { data: row, error } = await supabase.rpc("create_invitation", {
      _email: email, _role: data.role, _areas: [], _token_hash: fingerprint,
    });
    if (error) throw new Error(error.message);
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row["id"] !== "string") {
      throw new Error("Invitation registration could not be confirmed. No email sent.");
    }
    id = row["id"] as string;
  }

  const result = await deliverInvitationEmail(
    async () => (await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo: INVITATION_REDIRECT })).error,
    async () => (await supabaseAdmin.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: INVITATION_REDIRECT },
    })).error,
  );
  const { error: trackError } = await supabaseAdmin.from("invitations").update(
    result.status === "sent"
      ? { delivery_status: "sent", delivery_method: result.method, delivery_error: null, last_sent_at: new Date().toISOString() }
      : { delivery_status: "failed", delivery_method: result.method, delivery_error: result.error.slice(0, 300) },
  ).eq("id", id);
  if (trackError) console.error("invitation delivery tracking failed", trackError.message);
  return { id, resent: !!pending, ...result };
}
