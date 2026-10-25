export const INVITATION_REDIRECT = "https://venusxportal.vercel.app/auth/callback";

export type DeliveryMethod = "invite" | "sign_in_link";
export type DeliveryResult =
  | { status: "sent"; method: DeliveryMethod }
  | { status: "failed"; method: DeliveryMethod; error: string };

type ProviderError = { code?: string | undefined; status?: number | undefined; message?: string | undefined } | null;

export function isExistingIdentityError(error: ProviderError) {
  return !!error && (error.code === "email_exists" || /already been registered/i.test(error.message ?? ""));
}

/**
 * New identities get the native account invitation. An identity that already exists
 * cannot be re-invited by the provider (422 email_exists), so it gets a native sign-in
 * link instead; access is still granted only when the matching verified identity
 * accepts the registered invitation. Failures are reported, never treated as success.
 */
export async function deliverInvitationEmail(
  invite: () => Promise<ProviderError>,
  signInLink: () => Promise<ProviderError>,
): Promise<DeliveryResult> {
  const inviteError = await invite();
  if (!inviteError) return { status: "sent", method: "invite" };
  if (!isExistingIdentityError(inviteError)) {
    return { status: "failed", method: "invite", error: inviteError.message || "The email provider rejected the invitation." };
  }
  const linkError = await signInLink();
  if (!linkError) return { status: "sent", method: "sign_in_link" };
  return { status: "failed", method: "sign_in_link", error: linkError.message || "The email provider rejected the sign-in link." };
}
