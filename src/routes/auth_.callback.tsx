import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { completeInvitation, verifyAuthLink } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Confirm your email — VenusX Portal" },
      { name: "description", content: "Confirm your VenusX Portal account." },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const started = useRef(false);
  const [state, setState] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let active = true;

    async function finishConfirmation() {
      try {
        const params = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const error = params.get("error_description") ?? params.get("error") ??
          hash.get("error_description") ?? hash.get("error");
        if (error) {
          throw new Error("This verification link is invalid or expired. Return to sign in and request a new confirmation email.");
        }

        await verifyAuthLink(window.location.search, window.location.hash, "signup");

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

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center">
        <img src="/venusx-logo.jpeg" alt="VenusX" className="mx-auto h-16 w-16 rounded-full" />
        <h1 className="text-xl font-semibold">
          {state === "loading" ? "Confirming your account" : "Verification needs attention"}
        </h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {message}
        </p>
        {state === "error" && (
          <Button asChild className="w-full">
            <Link to="/auth">Return to sign in</Link>
          </Button>
        )}
      </section>
    </main>
  );
}
