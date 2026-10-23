import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/assets/venusx-logo.jpeg.asset.json";

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
  const [invite] = useState(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("invite"),
  );
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    const restorationFallback = window.setTimeout(() => {
      if (active) setReady(true);
    }, 5000);

    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) {
          setReady(true);
          return;
        }
        if (data.session) {
          if (invite) await acceptInvitation(invite);
          navigate({ to: "/dashboard", replace: true });
        } else {
          setReady(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        toast.error((error as Error).message);
        setReady(true);
      })
      .finally(() => {
        window.clearTimeout(restorationFallback);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session && !invite) {
        navigate({ to: "/dashboard", replace: true });
      } else {
        setReady(true);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(restorationFallback);
      data.subscription.unsubscribe();
    };
  }, [invite, navigate]);

  async function acceptInvitation(token: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { error } = await supabase.rpc("accept_invitation", { _token_hash: tokenHash });
    if (error) throw error;
    toast.success("Invitation accepted");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        setSent(true);
      } else if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/dashboard",
            data: { full_name: name },
          },
        });
        if (error) throw error;
        setSent(true);
      }
      if (invite && mode !== "forgot") {
        const { data } = await supabase.auth.getSession();
        if (data.session) await acceptInvitation(invite);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
          <img src={logo.url} alt="VenusX" className="h-20 w-20 rounded-full" />
          <h1 className="mt-4 text-2xl font-semibold">
            {mode === "in"
              ? "Welcome back"
              : mode === "up"
                ? "Create your account"
                : "Reset your password"}
          </h1>
        </div>
        {sent ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm">
            Check <b>{email}</b> and click the link we sent
            {mode === "forgot" ? " to choose a new password." : " to finish signing up."}
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
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
              <Button className="w-full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "in"
                    ? "Sign in"
                    : mode === "up"
                      ? "Sign up"
                      : "Send reset link"}
              </Button>
            </form>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setMode(mode === "in" ? "up" : "in")}
            >
              {mode === "in" ? "New here? Create an account" : "Back to sign in"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
