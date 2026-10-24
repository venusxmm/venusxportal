import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyAuthLink } from "@/lib/auth-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Choose a new password — VenusX Portal" },
      { name: "description", content: "Set a new password for your VenusX Portal account." },
      { property: "og:title", content: "Reset password — VenusX Portal" },
      { property: "og:description", content: "Set a new password for your VenusX Portal account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    verifyAuthLink(window.location.search, window.location.hash, "recovery")
      .then(() => {
        if (!active) return;
        setReady(true);
        window.history.replaceState(null, "", "/reset-password");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice(
          error instanceof Error ? error.message : "We could not validate this password link.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    if (pw !== pw2) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password updated");
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      navigate({ to: "/auth", search: { setup: "1" }, replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
        {notice && <p className="mb-4 text-sm text-muted-foreground">{notice}</p>}
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Open this page from the reset link in your email. If the link expired, request a new one
            from the sign-in page.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pw">New password</Label>
              <Input
                id="pw"
                type="password"
                required
                minLength={8}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input
                id="pw2"
                type="password"
                required
                minLength={8}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
              />
            </div>
            <Button className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
