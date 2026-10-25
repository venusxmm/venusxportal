import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CreatorAvatar } from "@/components/creator-avatar";
import { uploadImage } from "@/lib/media";
import type { Database } from "@/integrations/supabase/types";
import {
  AREA_LABEL,
  AREA_ORDER,
  CREATOR_STATUS_LABEL,
  TASK_STATUS_LABEL,
  useMe,
  type WorkArea,
} from "@/lib/me";
import { EmptyState, ErrorNote, Loading, PageHeader, Pill, isOverdue } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const STATUSES = ["lead", "onboarding", "active", "paused", "offboarded"] as const;
type Status = (typeof STATUSES)[number];

export const Route = createFileRoute("/_authenticated/creators/$id")({
  head: () => ({
    meta: [
      { title: "Creator — VenusX Portal" },
      {
        name: "description",
        content: "Review a VenusX creator profile and authorized workspace details.",
      },
      { property: "og:title", content: "Creator — VenusX Portal" },
      {
        property: "og:description",
        content: "Review a VenusX creator profile and authorized workspace details.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreatorPage,
});

function CreatorPage() {
  const { id } = Route.useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canSeePrivateDetails = !!me?.isStaff;
  const canEdit = !!(me?.isExec || me?.areas.includes("creator_management"));

  const c = useQuery({
    queryKey: ["creators", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators")
        .select(
          "id,stage_name,legal_name,email,user_id,status,positioning,objectives,social_links,archived_at,created_by,created_at,updated_at",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const privateDetails = useQuery({
    queryKey: ["creator-private-details", id],
    enabled: canSeePrivateDetails,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_private_details")
        .select("internal_notes,internal_photo_path")
        .eq("creator_id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [photoBusy, setPhotoBusy] = useState(false);
  const tasks = useQuery({
    queryKey: ["tasks", "creator", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,status,priority,due_date,source,visible_to_creator")
        .eq("creator_id", id)
        .is("archived_at", null)
        .order("due_date");
      if (error) throw error;
      return data;
    },
  });

  const [f, setF] = useState({
    stage_name: "",
    legal_name: "",
    email: "",
    positioning: "",
    objectives: "",
    internal_notes: "",
    status: "lead" as Status,
  });
  useEffect(() => {
    if (c.data)
      setF({
        stage_name: c.data.stage_name,
        legal_name: c.data.legal_name ?? "",
        email: c.data.email ?? "",
        positioning: c.data.positioning ?? "",
        objectives: c.data.objectives ?? "",
        internal_notes: privateDetails.data?.internal_notes ?? "",
        status: c.data.status,
      });
  }, [c.data, privateDetails.data]);

  const save = useMutation({
    mutationFn: async ({
      creator,
      internal_notes,
    }: {
      creator?: Database["public"]["Tables"]["creators"]["Update"];
      internal_notes?: string;
    }) => {
      if (creator) {
        const { error } = await supabase.from("creators").update(creator).eq("id", id);
        if (error) throw error;
      }
      if (internal_notes !== undefined) {
        const { error } = await supabase
          .from("creator_private_details")
          .upsert({ creator_id: id, internal_notes }, { onConflict: "creator_id" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["creators"] });
      qc.invalidateQueries({ queryKey: ["creator-private-details"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("creators").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Creator deleted");
      qc.invalidateQueries({ queryKey: ["creators"] });
      navigate({ to: "/creators" });
    },
    onError: (e) =>
      toast.error(
        (e as Error).message.includes("foreign key")
          ? "This creator has financial records; archive instead."
          : (e as Error).message,
      ),
  });
  const replacePhoto = async (file: File) => {
    setPhotoBusy(true);
    try {
      const extension = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
      const path = `${id}/internal.${extension}`;
      await uploadImage("creator-photos", path, file);
      const { error } = await supabase
        .from("creator_private_details")
        .upsert({ creator_id: id, internal_photo_path: path }, { onConflict: "creator_id" });
      if (error) throw error;
      toast.success("Internal creator photo updated");
      await privateDetails.refetch();
      qc.invalidateQueries({ queryKey: ["creators", "list"] });
      qc.invalidateQueries({ queryKey: ["creator-private-details"] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  };

  if (c.isLoading) return <Loading />;
  if (c.error) return <ErrorNote error={c.error} />;
  if (!c.data)
    return (
      <EmptyState title="Creator not found" body="It may not exist or you may not have access." />
    );
  if (canSeePrivateDetails && privateDetails.isLoading) return <Loading />;
  if (canSeePrivateDetails && privateDetails.error)
    return <ErrorNote error={privateDetails.error} />;
  const archived = !!c.data.archived_at;

  return (
    <div>
      <Link to="/creators" className="text-sm text-muted-foreground hover:text-gold">
        ← Creators
      </Link>
      <PageHeader
        title={c.data.stage_name}
        subtitle={
          archived ? "Archived" : c.data.user_id ? "Portal account linked" : "No portal account yet"
        }
        actions={
          canEdit && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  save.mutate({
                    creator: { archived_at: archived ? null : new Date().toISOString() },
                  })
                }
              >
                {archived ? "Restore" : "Archive"}
              </Button>
              {me?.isExec && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">Delete</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {c.data.stage_name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the profile and assignments. Linked tasks are kept
                        but unlinked. Creators with financial records cannot be deleted.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <form
          className="space-y-3 rounded-lg border bg-card p-5 lg:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              creator: {
                stage_name: f.stage_name,
                legal_name: f.legal_name || null,
                email: f.email.toLowerCase() || null,
                positioning: f.positioning || null,
                objectives: f.objectives || null,
                status: f.status,
              },
              internal_notes: f.internal_notes,
            });
          }}
        >
          <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Stage name</Label>
              <Input
                required
                value={f.stage_name}
                onChange={(e) => setF({ ...f, stage_name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Status })}>
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
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Positioning</Label>
              <Textarea
                value={f.positioning}
                onChange={(e) => setF({ ...f, positioning: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Objectives</Label>
              <Textarea
                value={f.objectives}
                onChange={(e) => setF({ ...f, objectives: e.target.value })}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Internal notes (never shown to creator)</Label>
              <Textarea
                value={f.internal_notes}
                onChange={(e) => setF({ ...f, internal_notes: e.target.value })}
              />
            </div>
          </fieldset>
          {canEdit && <Button disabled={save.isPending}>Save changes</Button>}
        </form>
        <Assignments creatorId={id} canEdit={canEdit} />
      </div>

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">
        Tasks & roadmap
      </h2>
      {(tasks.data ?? []).length === 0 ? (
        <EmptyState
          title="No tasks yet"
          body="Set status to Onboarding to generate onboarding tasks automatically."
        />
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {tasks.data!.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="flex-1">{t.title}</span>
              {t.source !== "manual" && <span className="text-xs text-muted-foreground">auto</span>}
              {!t.visible_to_creator && (
                <span className="text-xs text-muted-foreground">internal</span>
              )}
              <Pill value={t.status} label={TASK_STATUS_LABEL[t.status]} />
              <span
                className={
                  isOverdue(t.due_date, t.status) ? "text-destructive" : "text-muted-foreground"
                }
              >
                {t.due_date ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Assignments({ creatorId, canEdit }: { creatorId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [user, setUser] = useState("");
  const [area, setArea] = useState<WorkArea>("creator_management");
  const a = useQuery({
    queryKey: ["assignments", creatorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_assignments")
        .select("id,user_id,area")
        .eq("creator_id", creatorId);
      if (error) throw error;
      return data;
    },
  });
  const people = useQuery({
    queryKey: ["profiles"],
    queryFn: async () =>
      (
        await supabase
          .from("profiles")
          .select("id,full_name,email")
          .is("membership_removed_at", null)
          .order("full_name")
      ).data ?? [],
  });
  const name = (uid: string) => {
    const p = people.data?.find((x) => x.id === uid);
    return p?.full_name || p?.email || "Unknown";
  };
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("creator_assignments")
        .insert({ creator_id: creatorId, user_id: user, area });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments", creatorId] }),
    onError: (e) =>
      toast.error(
        (e as Error).message.includes("duplicate") ? "Already assigned." : (e as Error).message,
      ),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("creator_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assignments", creatorId] }),
  });
  return (
    <div className="rounded-lg border bg-card p-5">
      <h3 className="mb-3 font-medium">Assigned team</h3>
      {(a.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {a.data!.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2">
              <span>
                {name(x.user_id)}{" "}
                <span className="text-muted-foreground">· {AREA_LABEL[x.area]}</span>
              </span>
              {canEdit && (
                <button
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(x.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-4 space-y-2 border-t pt-4">
          <Select value={user} onValueChange={setUser}>
            <SelectTrigger>
              <SelectValue placeholder="Team member" />
            </SelectTrigger>
            <SelectContent>
              {(people.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={area} onValueChange={(v) => setArea(v as WorkArea)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AREA_ORDER.map((k) => (
                <SelectItem key={k} value={k}>
                  {AREA_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="w-full"
            disabled={!user || add.isPending}
            onClick={() => add.mutate()}
          >
            Assign
          </Button>
        </div>
      )}
    </div>
  );
}
