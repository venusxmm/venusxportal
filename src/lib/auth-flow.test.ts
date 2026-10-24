// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  getInvitationToken,
  invitationInitialMode,
  invitationStatusMessage,
  isAuthLinkTypeAllowed,
  normalizeEmailAddress,
  parseInvitationStatus,
  resolveWorkspaceRoute,
} from "@/lib/auth-flow";

describe("invitation and authentication state helpers", () => {
  it("reads invitation tokens from query strings and legacy URL fragments", () => {
    expect(getInvitationToken("?invite=query-token", "")).toBe("query-token");
    expect(getInvitationToken("", "#invite=fragment-token")).toBe("fragment-token");
    expect(getInvitationToken("?invite=query-token", "#invite=fragment-token")).toBe("query-token");
    expect(getInvitationToken("", "")).toBeNull();
  });

  it("normalizes invited emails consistently", () => {
    expect(normalizeEmailAddress("  Creator@Example.Test ")).toBe("creator@example.test");
  });

  it("accepts provider magic-link types only for account setup links", () => {
    expect(isAuthLinkTypeAllowed("signup", "signup")).toBe(true);
    expect(isAuthLinkTypeAllowed("email", "signup")).toBe(true);
    expect(isAuthLinkTypeAllowed("magiclink", "signup")).toBe(true);
    expect(isAuthLinkTypeAllowed("magiclink", "recovery")).toBe(false);
    expect(isAuthLinkTypeAllowed("recovery", "signup")).toBe(false);
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
