import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  authenticatedWorkspaceRoute,
  getInvitationStatus,
  getInvitationToken,
  hashInvitationToken,
  invitationInitialMode,
  invitationStatusMessage,
  normalizeEmailAddress,
  type InvitationStatus,
} from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — VenusX Portal" },
      { name: "description", content: "Sign in or create your VenusX Portal account." },
      { property: "og:title", content: "Sign in — VenusX Portal" },
      { property: "og:description", content: "Access the VenusX agency portal." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [invite] = useState(() =>
    typeof window === "undefined"
      ? null
      : getInvitationToken(window.location.search, window.location.hash),
  );
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [inviteStatus, setInviteStatus] = useState<InvitationStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (
      params.has("error") ||
      params.has("error_description") ||
      hashParams.has("error") ||
      hashParams.has("error_description")
    ) {
      return "This authentication link is invalid or expired. Request a fresh link or sign in.";
    }
    if (params.get("type") === "signup" || hashParams.get("type") === "signup") {
      return "Email confirmation was processed. If you are not signed in, sign in below to continue.";
    }
    return null;
  });

  useEffect(() => {
    let active = true;
    const processingUsers = new Set<string>();
    const completedUsers = new Set<string>();
    const invitationStatusPromise = invite ? getInvitationStatus(invite) : Promise.resolve(null);

    async function finishSession(userId: string, emailConfirmed: boolean) {
      if (!active || processingUsers.has(userId) || completedUsers.has(userId)) return;
      processingUsers.add(userId);
      try {
        let status: InvitationStatus | null = null;
        try {
          status = await invitationStatusPromise;
          if (active && status) {
            setInviteStatus(status);
            if (status.status !== "invalid") setEmail(status.email);
          }
        } catch (error) {
          if (!active) return;
          setNotice(
            error instanceof Error
              ? `Could not verify the invitation: ${error.message}`
              : "Could not verify the invitation. You can sign in, or ask an Executive for a new link.",
          );
        }

        if (invite && (status?.status === "pending" || status?.status === "accepted")) {
          if (!emailConfirmed) {
            setNotice("Confirm your email from the message we sent before continuing.");
            setReady(true);
            return;
          }
          const { error } = await supabase.rpc("accept_invitation", {
            _token_hash: await hashInvitationToken(invite),
          });
          if (error) throw error;
        }

        if (status?.status === "pending" || status?.status === "accepted") {
          const route = await authenticatedWorkspaceRoute();
          if (!active) return;
          completedUsers.add(userId);
          await queryClient.invalidateQueries({ queryKey: ["me"] });
          navigate({ to: route, replace: true });
          return;
        }

        if (invite && !status) return;
        const route = await authenticatedWorkspaceRoute();
        if (!active) return;
        completedUsers.add(userId);
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        navigate({ to: route, replace: true });
      } catch (error) {
        if (active) {
          setNotice(
            error instanceof Error
              ? error.message
              : "We could not complete sign-in. Check the invitation and try again.",
          );
          setReady(true);
        }
      } finally {
        processingUsers.delete(userId);
      }
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) return;
      queueMicrotask(
        () => void finishSession(session.user.id, Boolean(session.user.email_confirmed_at)),
      );
    });

    async function initialize() {
      try {
        const status = await invitationStatusPromise;
        if (!active) return;
        if (status) {
          setInviteStatus(status);
          if (status.status !== "invalid") setEmail(status.email);
          setMode(invitationInitialMode(status));
          const statusNotice = invitationStatusMessage(status);
          if (statusNotice) setNotice(statusNotice);
        }

        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (sessionData.session) {
          await finishSession(
            sessionData.session.user.id,
            Boolean(sessionData.session.user.email_confirmed_at),
          );
        } else {
          setReady(true);
        }
      } catch (error) {
        if (!active) return;
        setNotice(
          error instanceof Error
            ? error.message
            : "We could not verify this sign-in link. Request a fresh link or sign in.",
        );
        setReady(true);
      }
    }

    void initialize();
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [invite, navigate, queryClient]);

  async function acceptInvitation(token: string) {
    const { error } = await supabase.rpc("accept_invitation", {
      _token_hash: await hashInvitationToken(token),
    });
    if (error) throw error;
  }

  async function resendInvitationConfirmation() {
    if (!invite || inviteStatus?.status !== "pending") return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: inviteStatus.email,
        options: {
          emailRedirectTo:
            window.location.origin + `/auth?invite=${encodeURIComponent(invite)}&type=signup`,
        },
      });
      if (error) throw error;
      setNotice(`A new confirmation link was sent to ${inviteStatus.email}.`);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "We could not resend the confirmation link. Request a new invitation if this continues.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const normalizedEmail = normalizeEmailAddress(email);
      if (
        invite &&
        inviteStatus?.status === "pending" &&
        normalizedEmail !== inviteStatus.email.trim().toLowerCase()
      ) {
        throw new Error("Use the email address this invitation was sent to.");
      }

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        setSent(true);
      } else if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo:
              window.location.origin +
              (invite
                ? `/auth?invite=${encodeURIComponent(invite)}&type=signup`
                : "/auth?type=signup"),
            data: { full_name: name },
          },
        });
        if (error) throw error;
        setSent(true);
      }

      if (invite && mode !== "forgot") {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session) {
          if (!data.session.user.email_confirmed_at) {
            setNotice("Confirm your email from the message we sent before continuing.");
          } else {
            await acceptInvitation(invite);
          }
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Authentication failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const invitationAllowsSignup =
    !invite || (inviteStatus?.status === "pending" && inviteStatus.account_state === "new");
  const awaitingInvitationVerification =
    inviteStatus?.status === "pending" && inviteStatus.account_state === "unverified";
  const lockedEmail = Boolean(invite && inviteStatus?.status === "pending");

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
          Restoring your session…
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <img src="/venusx-logo.jpeg" alt="VenusX" className="h-20 w-20 rounded-full" />
          <h1 className="mt-4 text-2xl font-semibold">
            {mode === "in"
              ? "Welcome back"
              : mode === "up"
                ? invite
                  ? "Set up your invited account"
                  : "Create your account"
                : "Reset your password"}
          </h1>
        </div>
        {notice && (
          <p className="mb-4 rounded-md border bg-card p-3 text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {awaitingInvitationVerification && !sent && (
          <Button
            variant="outline"
            className="mb-4 w-full"
            disabled={busy}
            onClick={resendInvitationConfirmation}
          >
            Resend confirmation email
          </Button>
        )}
        {sent ? (
          <div className="space-y-4 rounded-lg border bg-card p-6 text-center text-sm">
            <p>
              Check <b>{email}</b> for the link to{" "}
              {mode === "forgot"
                ? "choose a new password."
                : invite
                  ? "confirm your email and finish accepting the invitation."
                  : "confirm your email and finish signing up."}
            </p>
            <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border bg-card p-6">
            <form onSubmit={submit} className="space-y-3">
              {mode === "up" && (
                <div className="space-y-1">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  readOnly={lockedEmail}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {mode !== "forgot" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pw">Password</Label>
                    {mode === "in" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-gold"
                        onClick={() => setMode("forgot")}
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="pw"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              )}
              <Button
                className="w-full"
                disabled={busy || (mode === "up" && !invitationAllowsSignup)}
              >
                {busy
                  ? "Please wait…"
                  : mode === "in"
                    ? "Sign in"
                    : mode === "up"
                      ? "Continue"
                      : "Send reset link"}
              </Button>
            </form>
            {invitationAllowsSignup && (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setMode(mode === "in" ? "up" : "in")}
              >
                {mode === "in"
                  ? invite
                    ? "New to VenusX? Set up your invited account"
                    : "New here? Create an account"
                  : "Back to sign in"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
