// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { deliverInvitationEmail, INVITATION_REDIRECT } from "./native-invitation";

describe("native invitation delivery", () => {
  it("uses only the explicit Vercel callback", () => {
    expect(INVITATION_REDIRECT).toBe("https://venusxportal.vercel.app/auth/callback");
  });
  it("new identity gets exactly one account invitation", async () => {
    const link = vi.fn();
    expect(await deliverInvitationEmail(async () => null, link)).toEqual({ status: "sent", method: "invite" });
    expect(link).not.toHaveBeenCalled();
  });
  it("existing identity (422 email_exists) gets a sign-in link instead of failing", async () => {
    const link = vi.fn(async () => null);
    const result = await deliverInvitationEmail(async () => ({ code: "email_exists", status: 422, message: "A user with this email address has already been registered" }), link);
    expect(result).toEqual({ status: "sent", method: "sign_in_link" });
    expect(link).toHaveBeenCalledTimes(1);
  });
  it("other provider errors are reported as failed, not sent", async () => {
    const link = vi.fn();
    const result = await deliverInvitationEmail(async () => ({ status: 429, message: "rate limit" }), link);
    expect(result).toEqual({ status: "failed", method: "invite", error: "rate limit" });
    expect(link).not.toHaveBeenCalled();
  });
});
