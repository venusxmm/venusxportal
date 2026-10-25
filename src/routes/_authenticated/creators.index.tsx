import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CreatorAvatar } from "@/components/creator-avatar";
import { uploadImage } from "@/lib/media";
import { CREATOR_STATUS_LABEL, useMe } from "@/lib/me";
import { EmptyState, ErrorNote, Loading, PageHeader, Pill } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUSES = ["lead", "onboarding", "active", "paused", "offboarded"] as const;

export const Route = createFileRoute("/_authenticated/creators/")({
  head: () => ({
    meta: [
      { title: "Creators — VenusX Portal" },
      {
        name: "description",
        content: "Manage VenusX creator profiles and workspace associations.",
      },
      { property: "og:title", content: "Creators — VenusX Portal" },
      {
        property: "og:description",
        content: "Manage VenusX creator profiles and workspace associations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Creators,
});

function Creators() {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const list = useQuery({
    queryKey: ["creators", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators")
        .select("id,stage_name,email,status,archived_at,user_id,created_at")
        .order("stage_name");
      if (error) throw error;
      return data;
    },
  });
  const canSeePrivateDetails = !!me?.isStaff;
  const privateDetails = useQuery({
    queryKey: ["creator-private-details", "list"],
    enabled: canSeePrivateDetails,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_private_details")
        .select("creator_id,internal_photo_path");
      if (error) throw error;
      return data;
    },
  });
  const canCreate = me?.isExec || me?.areas.includes("creator_management");
  const rows = (list.data ?? []).filter(
    (c) =>
      (showArchived ? !!c.archived_at : !c.archived_at) &&
      (status === "all" || c.status === status) &&
      c.stage_name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Creators"
        subtitle="One profile per creator, shared across every module."
        actions={canCreate && <NewCreator />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {CREATOR_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "Show current" : "Show archived"}
        </Button>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorNote error={list.error} retry={() => list.refetch()} />
      ) : privateDetails.error ? (
        <ErrorNote error={privateDetails.error} retry={() => privateDetails.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No creators found"
          body={
            canCreate ? "Add your first creator to start." : "No creators are assigned to you yet."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <Link
              key={c.id}
              to="/creators/$id"
              params={{ id: c.id }}
              className="rounded-lg border bg-card p-5 transition hover:border-gold/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <CreatorAvatar
                    path={
                      privateDetails.data?.find((details) => details.creator_id === c.id)
                        ?.internal_photo_path ?? null
                    }
                    name={c.stage_name}
                    size="sm"
                  />
                  <p className="text-lg font-semibold">{c.stage_name}</p>
                </div>
                <Pill value={c.status} />
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{c.email ?? "No email"}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {c.user_id ? "Portal account linked" : "No portal account yet"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewCreator() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ stage_name: "", legal_name: "", email: "", status: "lead" });
  const [photo, setPhoto] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const { data: creator, error } = await supabase
        .from("creators")
        .insert({
          stage_name: f.stage_name.trim(),
          legal_name: f.legal_name.trim() || null,
          email: f.email.trim().toLowerCase() || null,
          status: f.status as (typeof STATUSES)[number],
          created_by: me?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (photo) {
        const extension = photo.type.split("/")[1] === "jpeg" ? "jpg" : photo.type.split("/")[1];
        const path = `${creator.id}/internal.${extension}`;
        await uploadImage("creator-photos", path, photo);
        const { error: photoError } = await supabase
          .from("creator_private_details")
          .upsert(
            { creator_id: creator.id, internal_photo_path: path },
            { onConflict: "creator_id" },
          );
        if (photoError) throw photoError;
      }
    },
    onSuccess: () => {
      toast.success(
        f.status === "onboarding" ? "Creator added — onboarding tasks created." : "Creator added.",
      );
      qc.invalidateQueries({ queryKey: ["creators"] });
      qc.invalidateQueries({ queryKey: ["creator-private-details"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setOpen(false);
      setF({ stage_name: "", legal_name: "", email: "", status: "lead" });
      setPhoto(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New creator</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New creator</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <div className="space-y-1">
            <Label>Internal creator photo</Label>
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              For VenusX staff identification only · 5 MB maximum
            </p>
          </div>
          <div className="space-y-1">
            <Label>Stage name</Label>
            <Input
              required
              maxLength={120}
              value={f.stage_name}
              onChange={(e) => setF({ ...f, stage_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Legal name</Label>
            <Input
              value={f.legal_name}
              onChange={(e) => setF({ ...f, legal_name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              When the creator signs up with this email, their portal is linked automatically.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CREATOR_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" disabled={m.isPending}>
            Create
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
