import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  authenticatedWorkspaceRoute,
  getInvitationStatus,
  getInvitationToken,
  authLinkParameters,
  completeInvitation,
  verifyAuthLink,
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [invite, setInvite] = useState<string | null>(null);
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [inviteStatus, setInviteStatus] = useState<InvitationStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const search = window.location.search;
      const hash = window.location.hash;
      const token = getInvitationToken(search, hash);
      const params = authLinkParameters(search, hash);
      if (params.get("setup") === "1" && active) {
        setNotice("Your password is set. Sign in to continue.");
      }
      if (new URLSearchParams(search).get("verified") === "1" && active) {
        setNotice("Email verified successfully. You can now sign in.");
      }
      if (active) setInvite(token);
      try {
        if (params.has("error") || params.has("error_description")) {
          throw new Error(
            "This authentication link is invalid or expired. Request a new link or sign in.",
          );
        }
        // Handle provider OTP links for invitations before rendering the password form.
        if (["signup", "email", "magiclink"].includes(params.get("type") ?? "")) {
          const authUser = await verifyAuthLink(search, hash, "signup");
          if (token && params.get("set_password") === "1") {
            const status = await getInvitationStatus(token);
            if (
              status.status !== "pending" ||
              normalizeEmailAddress(status.email) !== normalizeEmailAddress(authUser.email ?? "")
            ) {
              throw new Error("This invitation is unavailable or does not match this account.");
            }
            if (active) {
              setInvite(token);
              setInviteStatus(status);
              setEmail(status.email);
              setMode("up");
              setPasswordSetupRequired(true);
              setNotice("Email verified. Set your password to finish accepting the invitation.");
            }
            window.history.replaceState(
              null,
              "",
              `/auth?invite=${encodeURIComponent(token)}&set_password=1`,
            );
            return;
          }
          await completeInvitation(token);
          await queryClient.cancelQueries();
          queryClient.clear();
          const { error } = await supabase.auth.signOut({ scope: "local" });
          if (error) throw error;
          if (active) {
            setNotice(
              token
                ? "Invitation accepted. Sign in with your existing password."
                : "Email verified successfully. You can now sign in.",
            );
          }
          window.history.replaceState(null, "", "/auth");
          return;
        }
        const status = token ? await getInvitationStatus(token) : null;
        if (!active) return;
        setInviteStatus(status);
        if (status) {
          if (status.status !== "invalid") setEmail(status.email);
          setMode(invitationInitialMode(status));
          setNotice(invitationStatusMessage(status));
          // Invalid invitation links never silently fall through into a workspace.
          if (
            status.status === "invalid" ||
            status.status === "expired" ||
            status.status === "revoked"
          ) {
            return;
          }
        }
        if (token && params.get("set_password") === "1") {
          if (status?.status !== "pending") {
            throw new Error("This invitation is unavailable or expired.");
          }
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (data.session) {
            const { data: userData, error: userError } = await supabase.auth.getUser();
            if (userError) throw userError;
            if (
              !userData.user?.email ||
              normalizeEmailAddress(userData.user.email) !== normalizeEmailAddress(status.email)
            ) {
              throw new Error("Sign in with the email address on this invitation.");
            }
            setMode("up");
            setEmail(status.email);
            setPasswordSetupRequired(true);
            setNotice("Set your password to finish accepting the invitation.");
            return;
          }
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session) {
          await completeInvitation(token);
          const route = await authenticatedWorkspaceRoute();
          if (active) navigate({ to: route, replace: true });
        }
      } catch (error) {
        if (active) {
          setNotice(
            error instanceof Error ? error.message : "Could not complete sign-in. Please retry.",
          );
        }
      } finally {
        if (active) setReady(true);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [navigate, queryClient]);

  function confirmationRedirect() {
    return window.location.origin + "/auth/callback";
  }

  async function resendInvitationConfirmation() {
    if (!email) return;
    setBusy(true);
    setNotice(null);
    try {
      let error: Error | null = null;
      if (invite) {
        const status = await getInvitationStatus(invite);
        if (status.status !== "pending") {
          throw new Error("This invitation is no longer pending. Ask an Executive for a new link.");
        }
        const redirect = new URL("/auth", window.location.origin);
        redirect.searchParams.set("invite", invite);
        if (status.account_state !== "verified") redirect.searchParams.set("set_password", "1");
        const result = await supabase.auth.signInWithOtp({
          email: normalizeEmailAddress(email),
          options: {
            emailRedirectTo: redirect.toString(),
            shouldCreateUser: true,
          },
        });
        error = result.error;
      } else {
        const result = await supabase.auth.resend({
          type: "signup",
          email: normalizeEmailAddress(email),
          options: { emailRedirectTo: confirmationRedirect() },
        });
        error = result.error;
      }
      if (error) throw error;
      setNotice(
        invite
          ? "Invitation email requested. Check your inbox; delivery is not confirmed."
          : "Confirmation requested. Check your email for the new link.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not resend confirmation. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resendPasswordReset() {
    if (!email) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmailAddress(email), {
        redirectTo: window.location.origin + "/reset-password",
      });
      if (error) throw error;
      setNotice("Password reset email requested. Delivery is not confirmed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not resend the reset email.");
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
        await completeInvitation(invite);
        const route = await authenticatedWorkspaceRoute();
        await queryClient.invalidateQueries({ queryKey: ["me"] });
        navigate({ to: route, replace: true });
      } else {
        if (password !== passwordConfirmation) throw new Error("Passwords do not match.");
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (invite && !sessionData.session) {
          throw new Error(
            "Open the one-time link from the invitation email to verify your email before setting a password.",
          );
        }
        if (invite && passwordSetupRequired && sessionData.session) {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError) throw userError;
          const freshStatus = await getInvitationStatus(invite);
          if (
            !userData.user?.email ||
            freshStatus.status !== "pending" ||
            normalizeEmailAddress(userData.user.email) !== normalizeEmailAddress(freshStatus.email)
          ) {
            throw new Error("This invitation is unavailable or does not match this account.");
          }
          const { error: passwordError } = await supabase.auth.updateUser({ password });
          if (passwordError) throw passwordError;
          await completeInvitation(invite);
          await queryClient.cancelQueries();
          queryClient.clear();
          const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
          if (signOutError) throw signOutError;
          setMode("in");
          setInvite(null);
          setInviteStatus(null);
          setPasswordSetupRequired(false);
          window.history.replaceState(null, "", "/auth?setup=1");
          setNotice("Your password is set and your invitation is accepted. Sign in to continue.");
          return;
        }
        const freshStatus = invite ? await getInvitationStatus(invite) : null;
        if (invite && (freshStatus?.status !== "pending" || freshStatus.account_state !== "new")) {
          if (freshStatus) {
            setInviteStatus(freshStatus);
            setMode("in");
          }
          throw new Error(
            "This account already exists or the invitation is unavailable. Sign in or resend confirmation; your existing password will not be changed.",
          );
        }
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: confirmationRedirect(),
            data: { full_name: name },
          },
        });
        if (error) throw error;
        if (!data.user || data.user.identities?.length === 0) {
          throw new Error(
            "Account setup could not be confirmed. Sign in or request a new confirmation link.",
          );
        }
        if (data.session) {
          if (invite) await completeInvitation(invite);
          await queryClient.cancelQueries();
          queryClient.clear();
          const { error: signOutError } = await supabase.auth.signOut();
          if (signOutError) throw signOutError;
          setMode("in");
          if (invite) {
            window.history.replaceState(null, "", "/auth?setup=1");
            setInvite(null);
            setInviteStatus(null);
            setNotice("Your password is set and your invitation is accepted. Sign in to continue.");
          } else {
            setNotice("Your account is ready. Sign in to continue.");
          }
        } else {
          setSent(true);
          if (invite) setInviteStatus(await getInvitationStatus(invite));
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
    !invite ||
    (inviteStatus?.status === "pending" &&
      (inviteStatus.account_state === "new" || passwordSetupRequired));
  const invitationBlocked = Boolean(
    invite && (!inviteStatus || ["invalid", "expired", "revoked"].includes(inviteStatus.status)),
  );
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
        {(awaitingInvitationVerification || sent) && (
          <Button
            variant="outline"
            className="mb-4 w-full"
            disabled={busy || !email}
            onClick={mode === "forgot" ? resendPasswordReset : resendInvitationConfirmation}
          >
            {mode === "forgot"
              ? "Resend password reset email"
              : invite
                ? "Resend invitation email"
                : "Resend confirmation email"}
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
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSent(false);
                setMode("in");
              }}
            >
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
                      <Button
                        variant="link"
                        type="button"
                        className="text-xs text-muted-foreground hover:text-gold"
                        onClick={() => setMode("forgot")}
                      >
                        Forgot password?
                      </Button>
                    )}
                  </div>
                  <Input
                    id="pw"
                    type="password"
                    required
                    minLength={8}
                    autoComplete={mode === "up" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              )}
              {mode === "up" && (
                <div className="space-y-1">
                  <Label htmlFor="pw-confirm">Confirm password</Label>
                  <Input
                    id="pw-confirm"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={passwordConfirmation}
                    onChange={(event) => setPasswordConfirmation(event.target.value)}
                  />
                </div>
              )}
              <Button
                className="w-full"
                disabled={
                  busy ||
                  (mode !== "forgot" && invitationBlocked) ||
                  (mode === "up" && !invitationAllowsSignup)
                }
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
              <Button
                variant="link"
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => setMode(mode === "in" ? "up" : "in")}
              >
                {mode === "in"
                  ? invite
                    ? "New to VenusX? Set up your invited account"
                    : "New here? Create an account"
                  : "Back to sign in"}
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
