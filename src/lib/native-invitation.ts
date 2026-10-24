export const INVITATION_REDIRECT = "https://venusxportal.vercel.app/auth/callback";

export async function deliverRegisteredInvitation(
  register: () => Promise<string>,
  send: () => Promise<void>,
  revoke: (id: string) => Promise<void>,
) {
  const id = await register();
  try {
    await send();
  } catch {
    try {
      await revoke(id);
    } catch {
      throw new Error("Email delivery could not be confirmed. The invitation remains pending; revoke it before retrying.");
    }
    throw new Error("Email delivery could not be confirmed. The invitation was revoked; no access was granted. Existing users should sign in rather than receive a new-account invitation.");
  }
  return { id, sent: true as const };
}