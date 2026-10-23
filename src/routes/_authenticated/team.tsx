import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AREA_LABEL, AREA_ORDER, useMe, type AppRole, type WorkArea } from "@/lib/me";
import { EmptyState, Loading, PageHeader } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ROLES: AppRole[] = ["executive", "employee", "creator", "partner"];
const AREAS: readonly WorkArea[] = AREA_ORDER;

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({ meta: [{ title: "Team & Access — VenusX Portal" }] }),
  component: Team,
});

function Team() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const data = useQuery({
    enabled: !!me?.isExec,
    queryKey: ["team"],
    queryFn: async () => {
      const [p, r, a] = await Promise.all([
        supabase
          .from("profiles")
          .select("id,full_name,nickname,avatar_url,email,created_at")
          .order("created_at"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("user_areas").select("user_id,area"),
      ]);
      if (p.error) throw p.error;
      return { people: p.data, roles: r.data ?? [], areas: a.data ?? [] };
    },
  });
  const invitations = useQuery({
    enabled: !!me?.isExec,
    queryKey: ["invitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select("id,email,role,expires_at,accepted_at,revoked_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const toggleRole = useMutation({
    mutationFn: async ({ uid, role, on }: { uid: string; role: AppRole; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
        if (error && !error.message.includes("duplicate")) throw error;
        return;
      }
      const { data, error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", uid)
        .eq("role", role)
        .select("id");
      if (error)
        throw new Error(
          error.message.includes("last executive")
            ? "You can't remove the last executive."
            : error.message,
        );
      if (!data?.length)
        throw new Error(
          uid === me?.id && role === "executive"
            ? "You can't remove your own executive role."
            : "This role change was not allowed.",
        );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Access updated");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["team"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  const toggleArea = useMutation({
    mutationFn: async ({ uid, area, on }: { uid: string; area: WorkArea; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("user_areas").insert({ user_id: uid, area });
        if (error && !error.message.includes("duplicate")) throw error;
        return;
      }
      const { data, error } = await supabase
        .from("user_areas")
        .delete()
        .eq("user_id", uid)
        .eq("area", area)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Couldn't remove this area.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const removeAccess = useMutation({
    mutationFn: async (uid: string) => {
      if (uid === me?.id) throw new Error("You cannot remove your own access.");
      const areas = await supabase.from("user_areas").delete().eq("user_id", uid);
      if (areas.error) throw areas.error;
      const roles = await supabase.from("user_roles").delete().eq("user_id", uid).select("id");
      if (roles.error) throw roles.error;
      if (!roles.data?.length) throw new Error("This member has no removable roles.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast.success("Member access revoked");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!me?.isExec) return <EmptyState title="Restricted" body="Only executives manage access." />;
  if (data.isLoading) return <Loading />;
  const d = data.data!;
  return (
    <div>
      <PageHeader
        title="Team & Access"
        subtitle="People sign up themselves; you grant roles and work areas here. Every change is audited."
      />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="p-3">Person</th>
              {ROLES.map((r) => (
                <th key={r} className="p-3 capitalize">
                  {r}
                </th>
              ))}
              <th className="p-3">Employee areas</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.people.map((p) => {
              const has = (r: AppRole) => d.roles.some((x) => x.user_id === p.id && x.role === r);
              const isEmp = has("employee");
              return (
                <tr key={p.id}>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-soft text-gold">
                          {(p.nickname || p.full_name || p.email || "?").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{p.nickname || p.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.full_name && p.nickname ? `${p.full_name} · ` : ""}
                          {p.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="p-3">
                      <Checkbox
                        aria-label={`${r} for ${p.email}`}
                        checked={has(r)}
                        disabled={p.id === me.id && r === "executive"}
                        onCheckedChange={(v) => toggleRole.mutate({ uid: p.id, role: r, on: !!v })}
                      />
                    </td>
                  ))}
                  <td className="p-3">
                    {isEmp ? (
                      <div className="flex flex-wrap gap-3">
                        {AREAS.map((a) => (
                          <label key={a} className="flex items-center gap-1 text-xs">
                            <Checkbox
                              checked={d.areas.some((x) => x.user_id === p.id && x.area === a)}
                              onCheckedChange={(v) =>
                                toggleArea.mutate({ uid: p.id, area: a, on: !!v })
                              }
                            />
                            {AREA_LABEL[a]}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Select Employee to assign areas
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {p.id !== me.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={removeAccess.isPending}
                        onClick={() =>
                          confirm(
                            `Revoke access for ${p.full_name || p.email}? Their profile will remain available for a future invitation.`,
                          ) && removeAccess.mutate(p.id)
                        }
                      >
                        Revoke access
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <InvitationPanel
        invitations={invitations.data ?? []}
        onChanged={() => qc.invalidateQueries({ queryKey: ["invitations"] })}
      />
      <p className="mt-4 text-xs text-muted-foreground">
        Creators are linked automatically when they sign up with the email on their creator profile.
        Partner access is reserved; no business areas are shared with partners yet.
      </p>
    </div>
  );
}

async function invitationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { token, hash };
}

function InvitationPanel({
  invitations,
  onChanged,
}: {
  invitations: {
    id: string;
    email: string;
    role: AppRole;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  }[];
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("employee");
  const [busy, setBusy] = useState(false);
  const [recentLinks, setRecentLinks] = useState<Record<string, string>>({});
  const create = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const { token, hash } = await invitationToken();
      const { data, error } = await supabase.rpc("create_invitation", {
        _email: email.trim(),
        _token_hash: hash,
        _role: role,
        _areas: [],
      });
      if (error) throw error;
      await navigator.clipboard.writeText(`${window.location.origin}/auth?invite=${token}`);
      if (data && typeof data === "object" && "id" in data)
        setRecentLinks((links) => ({
          ...links,
          [String(data["id"])]: `${window.location.origin}/auth?invite=${token}`,
        }));
      toast.success("Invitation created and link copied. Email delivery was not attempted.");
      setEmail("");
      onChanged();
      void data;
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    const { error } = await supabase.rpc("revoke_invitation", { _id: id });
    if (error) toast.error(error.message);
    else {
      toast.success("Invitation revoked");
      onChanged();
    }
  };
  return (
    <section className="mt-6 rounded-lg border bg-card p-5">
      <h2 className="font-medium">Invitations</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a single-use link for a specific email. Email delivery still requires an external
        provider configuration.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-1">
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="member@example.com"
          />
        </div>
        <div className="w-40 space-y-1">
          <Label>Role</Label>
          <Select value={role} onValueChange={(value) => setRole(value as AppRole)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item.replace(/^./, (letter) => letter.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={busy || !email.trim()} onClick={create}>
          Create link
        </Button>
      </div>
      <div className="mt-4 divide-y rounded-md border">
        {invitations
          .filter(
            (item) =>
              !item.accepted_at && !item.revoked_at && new Date(item.expires_at) > new Date(),
          )
          .map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <span>
                {item.email} · {item.role.replace(/^./, (letter) => letter.toUpperCase())}
                <span className="ml-2 text-xs text-muted-foreground">
                  expires {new Date(item.expires_at).toLocaleDateString()}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!recentLinks[item.id]}
                title={
                  recentLinks[item.id]
                    ? "Copy invitation link"
                    : "The link is only available immediately after creation"
                }
                onClick={() => {
                  const link = recentLinks[item.id];
                  if (link)
                    void navigator.clipboard
                      .writeText(link)
                      .then(() => toast.success("Invitation link copied"));
                }}
              >
                <Copy className="mr-1 h-4 w-4" /> Copy link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => revoke(item.id)}
              >
                Revoke
              </Button>
            </div>
          ))}
      </div>
    </section>
  );
}
