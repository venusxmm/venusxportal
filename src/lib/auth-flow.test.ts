// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn().mockResolvedValue({ error: null }),
  initialize: vi.fn().mockResolvedValue({ error: null }),
  getUser: vi.fn().mockResolvedValue({ data: { user: { id: "qa", email_confirmed_at: "2026-10-24" } }, error: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

import {
  getInvitationToken,
  invitationInitialMode,
  invitationStatusMessage,
  normalizeEmailAddress,
  parseInvitationStatus,
  resolveWorkspaceRoute,
  assertAuthLink,
  verifyAuthLink,
} from "@/lib/auth-flow";

describe("invitation and authentication state helpers", () => {
  it("rejects ordinary visits as recovery authorization even with an existing session", () => {
    expect(() => assertAuthLink("", "", "recovery")).toThrow(/valid link/i);
    expect(() => assertAuthLink("?type=invite&token_hash=qa", "", "recovery")).toThrow(/not valid/i);
  });
  it("rejects provider errors before any token exchange", () => {
    expect(() => assertAuthLink("", "#error=access_denied&error_code=otp_expired", "invite")).toThrow(/expired/i);
  });
  it("shares one native invitation verification across concurrent mounts", async () => {
    const first = verifyAuthLink("?type=invite&token_hash=qa-invite", "", "invite");
    const second = verifyAuthLink("?type=invite&token_hash=qa-invite", "", "invite");
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "qa-invite", type: "invite" });
  });
  it("delegates valid implicit recovery links to the SDK without a second OTP exchange", async () => {
    await verifyAuthLink("", "#type=recovery&access_token=qa&refresh_token=qa", "recovery");
    expect(auth.initialize).toHaveBeenCalledTimes(1);
  });
  it("reads invitation tokens from query strings and legacy URL fragments", () => {
    expect(getInvitationToken("?invite=query-token", "")).toBe("query-token");
    expect(getInvitationToken("", "#invite=fragment-token")).toBe("fragment-token");
    expect(getInvitationToken("?invite=query-token", "#invite=fragment-token")).toBe("query-token");
    expect(getInvitationToken("", "")).toBeNull();
  });

  it("normalizes invited emails consistently", () => {
    expect(normalizeEmailAddress("  Creator@Example.Test ")).toBe("creator@example.test");
  });

  it("routes pending invitations to account setup and completed invitations to sign-in", () => {
    const pending = {
      status: "pending",
      email: "creator@example.test",
      role: "creator",
      expires_at: "2030-01-01T00:00:00Z",
      account_state: "new",
    } as const;
    const accepted = { ...pending, status: "accepted" } as const;
    const verified = { ...pending, account_state: "verified" } as const;

    expect(invitationInitialMode(pending)).toBe("up");
    expect(invitationInitialMode(accepted)).toBe("in");
    expect(invitationInitialMode(verified)).toBe("in");
    expect(invitationInitialMode(null)).toBe("in");
    expect(invitationStatusMessage(accepted)).toMatch(/already been used/i);
  });

  it("rejects malformed invitation status and routes only Creator-only accounts to the Creator portal", () => {
    expect(() => parseInvitationStatus({ status: "pending", role: "executive" })).toThrow(
      /incomplete/i,
    );
    expect(resolveWorkspaceRoute(["creator"])).toBe("/portal");
    expect(resolveWorkspaceRoute(["creator", "employee"])).toBe("/dashboard");
    expect(resolveWorkspaceRoute(["partner"])).toBe("/dashboard");
  });
});
