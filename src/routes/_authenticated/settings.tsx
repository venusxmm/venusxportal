import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loading } from "@/components/portal";

import { APP_VERSION_LABEL } from "@/lib/version";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const profile = useQuery({
    queryKey: ["profile", "self"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name,nickname,description,avatar_url")
        .eq("id", user.user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState<{
    full_name: string;
    nickname: string;
    description: string;
    avatar_url: string;
  } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("You are signed out.");
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name.trim() || null,
          nickname: form.nickname.trim() || null,
          description: form.description.trim() || null,
          avatar_url: form.avatar_url.trim() || null,
        })
        .eq("id", user.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["profile", "self"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });
  if (profile.isLoading) return <Loading />;
  const values = form ?? {
    full_name: profile.data?.full_name ?? "",
    nickname: profile.data?.nickname ?? "",
    description: profile.data?.description ?? "",
    avatar_url: profile.data?.avatar_url ?? "",
  };
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Settings
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Account & app preferences</h1>
      </header>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-medium">Your profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Only your profile details can be changed here. Roles and access remain managed separately.
        </p>
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input
                value={values.full_name}
                onChange={(e) => setForm({ ...values, full_name: e.target.value })}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label>Nickname</Label>
              <Input
                value={values.nickname}
                onChange={(e) => setForm({ ...values, nickname: e.target.value })}
                maxLength={80}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Profile photo URL</Label>
            <Input
              type="url"
              placeholder="https://…"
              value={values.avatar_url}
              onChange={(e) => setForm({ ...values, avatar_url: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={values.description}
              onChange={(e) => setForm({ ...values, description: e.target.value })}
              maxLength={1000}
            />
          </div>
          <Button disabled={save.isPending}>Save profile</Button>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Application version</p>
            <p className="mt-2 text-2xl font-semibold">{APP_VERSION_LABEL}</p>
          </div>
          <div className="rounded-full border bg-muted/60 p-2 text-gold">
            <Sparkles className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Official releases should update this version only when a production tag is published.
          Local previews stay development-only and should not masquerade as a new official release.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-full border bg-muted/60 p-2 text-emerald-500">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-medium">Security & access</h2>
            <p className="text-sm text-muted-foreground">
              Authentication stays managed by Supabase and the server-side access rules.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
