import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];
type Json = Database["public"]["Functions"]["get_invitation_status"]["Returns"];

export type InvitationStatus =
  | { status: "invalid" }
  | {
      status: "pending" | "accepted" | "expired" | "revoked";
      email: string;
      role: AppRole;
      expires_at: string;
      account_state: "new" | "unverified" | "verified";
    };

export type WorkspaceRoute = "/dashboard" | "/portal";

const APP_ROLES: readonly AppRole[] = ["executive", "employee", "creator", "partner"];

function isAppRole(value: string): value is AppRole {
  return APP_ROLES.some((role) => role === value);
}

export function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export function getInvitationToken(search: string, hash: string): string | null {
  const queryToken = new URLSearchParams(search).get("invite");
  const hashToken = new URLSearchParams(hash.replace(/^#/, "")).get("invite");
  return queryToken ?? hashToken;
}

export function parseInvitationStatus(value: Json): InvitationStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The invitation status response was invalid.");
  }

  const status = value["status"];
  if (status === "invalid") return { status };
  if (
    status !== "pending" &&
    status !== "accepted" &&
    status !== "expired" &&
    status !== "revoked"
  ) {
    throw new Error("The invitation status response was invalid.");
  }

  const email = value["email"];
  const role = value["role"];
  const expiresAt = value["expires_at"];
  const accountState = value["account_state"];
  if (
    typeof email !== "string" ||
    typeof role !== "string" ||
    !isAppRole(role) ||
    typeof expiresAt !== "string" ||
    (accountState !== "new" && accountState !== "unverified" && accountState !== "verified")
  ) {
    throw new Error("The invitation status response was incomplete.");
  }

  return { status, email, role, expires_at: expiresAt, account_state: accountState };
}

export function invitationInitialMode(status: InvitationStatus | null): "in" | "up" {
  return status?.status === "pending" && status.account_state === "new" ? "up" : "in";
}

export function invitationStatusMessage(status: InvitationStatus): string | null {
  switch (status.status) {
    case "pending":
      if (status.account_state === "new") {
        return `You are invited as ${status.role}. Create an account with this email to continue.`;
      }
      if (status.account_state === "unverified") {
        return "Your account setup is saved. Confirm your email to finish, then sign in to accept this invitation.";
      }
      return "Your account is ready. Sign in with this email to accept the invitation.";
    case "accepted":
      return "This invitation has already been used. Sign in to continue.";
    case "expired":
      return "This invitation has expired. Sign in or ask an Executive for a new link.";
    case "revoked":
      return "This invitation was revoked. Sign in or ask an Executive for access.";
    case "invalid":
      return "This invitation link is invalid. Sign in or ask an Executive for a new link.";
  }
}

export function resolveWorkspaceRoute(roles: readonly AppRole[]): WorkspaceRoute {
  if (roles.includes("creator") && !roles.includes("executive") && !roles.includes("employee")) {
    return "/portal";
  }
  return "/dashboard";
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getInvitationStatus(token: string): Promise<InvitationStatus> {
  const { data, error } = await supabase.rpc("get_invitation_status", {
    _token_hash: await hashInvitationToken(token),
  });
  if (error) throw error;
  return parseInvitationStatus(data);
}

export async function authenticatedWorkspaceRoute(): Promise<WorkspaceRoute> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sign in to continue.");
  if (!userData.user.email_confirmed_at) {
    throw new Error("Confirm your email address before continuing.");
  }

  const { error: pendingError } = await supabase.rpc("complete_pending_invitation");
  if (pendingError) throw pendingError;

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (rolesError) throw rolesError;

  const roles = (roleRows ?? []).map((row) => row.role);
  if (roles.includes("creator")) {
    const { data: creatorId, error } = await supabase.rpc("resolve_creator_link");
    if (error) throw error;
    if (!creatorId) {
      throw new Error(
        "Creator account has no valid workspace. Ask an Executive to review the association.",
      );
    }
  }

  return resolveWorkspaceRoute(roles);
}

export function authLinkParameters(search: string, hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  new URLSearchParams(search).forEach((value, key) => params.set(key, value));
  return params;
}

/** The SDK handles implicit and PKCE links; token_hash templates need verifyOtp. */
export function assertAuthLink(search: string, hash: string, expected: "signup" | "invite" | "recovery") {
  const params = authLinkParameters(search, hash);
  if (params.has("error") || params.has("error_description")) {
    throw new Error("This authentication link is invalid, already used or expired. Request a new link.");
  }
  const type = params.get("type");
  if (type && type !== expected && !(expected === "signup" && type === "email")) {
    throw new Error("This link is not valid for this action.");
  }
  if (!params.get("code") && !(type && (params.get("token_hash") || (params.get("access_token") && params.get("refresh_token"))))) {
    throw new Error("Open a valid link from your email to continue.");
  }
  return params;
}

const linkVerifications = new Map<string, Promise<Awaited<ReturnType<typeof verifyAuthLinkOnce>>>>();

export function verifyAuthLink(search: string, hash: string, expected: "signup" | "invite" | "recovery") {
  const key = JSON.stringify([search, hash, expected]);
  const existing = linkVerifications.get(key);
  if (existing) return existing;
  const result = verifyAuthLinkOnce(search, hash, expected);
  linkVerifications.set(key, result);
  return result;
}

async function verifyAuthLinkOnce(
  search: string,
  hash: string,
  expected: "signup" | "invite" | "recovery",
) {
  const params = assertAuthLink(search, hash, expected);
  const tokenHash = params.get("token_hash");
  if (tokenHash) {
    const type = params.get("type");
    if (type !== expected && !(expected === "signup" && type === "email")) {
      throw new Error("This link is not valid for this action.");
    }
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw error;
  } else {
    const { error } = await supabase.auth.initialize();
    if (error) throw error;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.email_confirmed_at) {
    throw new Error("Open a valid verification link from your email.");
  }
  return data.user;
}

export async function completeInvitation(token: string | null) {
  const { error } = token
    ? await supabase.rpc("accept_invitation", { _token_hash: await hashInvitationToken(token) })
    : await supabase.rpc("complete_pending_invitation");
  if (error) throw error;
}
