// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { deliverRegisteredInvitation, INVITATION_REDIRECT } from "./native-invitation";

describe("native invitation delivery", () => {
  it("uses only the explicit Vercel callback", () => {
    expect(INVITATION_REDIRECT).toBe("https://venusxportal.vercel.app/auth/callback");
  });
  it("registers before sending exactly one native email", async () => {
    const order: string[] = [];
    const send = vi.fn(async () => { order.push("send"); });
    const revoke = vi.fn();
    expect(await deliverRegisteredInvitation(async () => { order.push("register"); return "qa"; }, send, revoke)).toEqual({ id: "qa", sent: true });
    expect(order).toEqual(["register", "send"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });
  it("never sends when backend registration rejects access", async () => {
    const send = vi.fn();
    await expect(deliverRegisteredInvitation(async () => { throw new Error("Forbidden"); }, send, vi.fn())).rejects.toThrow("Forbidden");
    expect(send).not.toHaveBeenCalled();
  });
  it("revokes only the new invitation after failed sending", async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    await expect(deliverRegisteredInvitation(async () => "qa-new", async () => { throw new Error("send failed"); }, revoke)).rejects.toThrow(/revoked/);
    expect(revoke).toHaveBeenCalledWith("qa-new");
  });
});