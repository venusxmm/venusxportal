import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authLinkParameters, completeInvitation, verifyAuthLink } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth_/callback")({
  head: () => ({
    meta: [
      { title: "Confirm your email — VenusX Portal" },
      { name: "description", content: "Confirm your VenusX Portal account." },
      { property: "og:title", content: "Activate your account — VenusX Portal" },
      { property: "og:description", content: "Verify your invitation and set your VenusX password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const [state, setState] = useState<"loading" | "error" | "password" | "success">("loading");
  const [message, setMessage] = useState("Verifying your email…");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function finishConfirmation() {
      try {
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const error =
          params.get("error_description") ??
          params.get("error") ??
          hash.get("error_description") ??
          hash.get("error");
        if (error) {
          throw new Error(
            "This verification link is invalid or expired. Return to sign in and request a new confirmation email.",
          );
        }

        const isInvite = authLinkParameters(window.location.search, window.location.hash).get("type") === "invite";
        await verifyAuthLink(window.location.search, window.location.hash, isInvite ? "invite" : "signup");
        if (!active) return;
        if (isInvite) {
          window.history.replaceState(null, "", "/auth/callback");
          setMessage("Your invitation is verified. Choose your password.");
          setState("password");
          return;
        }

        // Accept the invitation only after the provider confirms this user's email.
        // The RPC matches the signed-in, verified identity to its pending invitation.
        await completeInvitation(null);

        // The intended UX is verified -> confirmation message -> explicit sign-in.
        // Local scope avoids terminating sessions on the user's other devices.
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;

        window.location.replace("/auth?verified=1");
      } catch (cause) {
        if (!active) return;
        setMessage(
          cause instanceof Error
            ? cause.message
            : "We could not verify this link. Return to sign in and try again.",
        );
        setState("error");
      }
    }

    void finishConfirmation();
    return () => {
      active = false;
    };
  }, []);

  async function setInvitedPassword(event: React.FormEvent) {
    event.preventDefault();
    if (state !== "password" || busy) return;
    if (password !== confirmation) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await completeInvitation(null);
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setPassword("");
      setConfirmation("");
      setState("success");
      setMessage("Your password is set and your invitation is accepted. Sign in to continue.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not finish account setup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center">
        <img src="/venusx-logo.jpeg" alt="VenusX" className="mx-auto h-16 w-16 rounded-full" />
        <h1 className="text-xl font-semibold">
          {state === "loading" ? "Confirming your account" : state === "password" ? "Set your password" : state === "success" ? "Account ready" : "Verification needs attention"}
        </h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
        {state === "password" && (
          <form onSubmit={setInvitedPassword} className="space-y-3 text-left">
            <Label htmlFor="invite-password">New password</Label>
            <Input id="invite-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
            <Label htmlFor="invite-confirmation">Confirm password</Label>
            <Input id="invite-confirmation" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e => setConfirmation(e.target.value)} />
            <Button className="w-full" disabled={busy}>{busy ? "Saving…" : "Set password"}</Button>
          </form>
        )}
        {(state === "error" || state === "success") && (
          <Button asChild className="w-full">
            <Link to="/auth">Return to sign in</Link>
          </Button>
        )}
      </section>
    </main>
  );
}
