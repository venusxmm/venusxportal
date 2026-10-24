import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { sendNativeInvitation } from "@/lib/invitations.functions";
import { copyText } from "@/lib/clipboard";
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
  head: () => ({ meta: [
    { title: "Team & Access — VenusX Portal" },
    { name: "description", content: "Manage VenusX members, roles and invitations." },
    { property: "og:title", content: "Team & Access — VenusX Portal" },
    { property: "og:description", content: "Manage VenusX members, roles and invitations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
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
          .select(
            "id,full_name,nickname,avatar_url,email,created_at,access_revoked_at,membership_removed_at",
          )
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
      const { data, error } = await supabase.rpc("revoke_team_member_access", {
        _user_id: uid,
      });
      if (error) throw error;
      if (!data) throw new Error("Member access was not revoked.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast.success("Member access revoked");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const removeMember = useMutation({
    mutationFn: async (uid: string) => {
      const { data, error } = await supabase.rpc("remove_team_member", { _user_id: uid });
      if (error) throw error;
      if (!data) throw new Error("Member was not removed.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
      toast.success("Member removed from Team & Access");
    },
    onError: (error) => toast.error((error as Error).message),
  });

  if (!me?.isExec) return <EmptyState title="Restricted" body="Only executives manage access." />;
  if (data.isLoading) return <Loading />;
  const d = data.data;
  if (!d)
    return (
      <EmptyState
        title="Team could not be loaded"
        body={data.error?.message ?? "No team data was returned."}
      />
    );
  return (
    <div>
      <PageHeader
        title="Team & Access"
        subtitle="People sign up themselves; you grant roles and work areas here. Every change is audited."
      />
      <div className="max-w-full overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[1080px] text-sm">
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
            {d.people
              .filter((person) => !person.membership_removed_at)
              .map((p) => {
                const has = (r: AppRole) => d.roles.some((x) => x.user_id === p.id && x.role === r);
                const hasArea = d.areas.some((area) => area.user_id === p.id);
                const hasAccess = ROLES.some(has) || hasArea;
                const accessRevoked = !!p.access_revoked_at;
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
                            {(p.nickname || p.full_name || p.email || "?")
                              .slice(0, 1)
                              .toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{p.nickname || p.full_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.full_name && p.nickname ? `${p.full_name} · ` : ""}
                            {p.email}
                          </p>
                          {accessRevoked && (
                            <p className="text-xs font-medium text-destructive">Access revoked</p>
                          )}
                        </div>
                      </div>
                    </td>
                    {ROLES.map((r) => (
                      <td key={r} className="p-3">
                        <Checkbox
                          aria-label={`${r} for ${p.email}`}
                          checked={has(r)}
                          disabled={p.id === me.id && r === "executive"}
                          onCheckedChange={(v) =>
                            toggleRole.mutate({ uid: p.id, role: r, on: !!v })
                          }
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
                      {p.id !== me.id && hasAccess && (
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
                      {p.id !== me.id && accessRevoked && !hasAccess && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={removeMember.isPending}
                          onClick={() =>
                            confirm(
                              `Remove ${p.nickname || p.full_name || p.email} from Team & Access? Their sign-in identity will remain for historical references, but without roles or work areas they will not have portal access. A new role grant or accepted invitation can restore membership.`,
                            ) && removeMember.mutate(p.id)
                          }
                        >
                          Remove from team
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
        recoveryMembers={d.people
          .filter((person) => person.access_revoked_at || person.membership_removed_at)
          .map((person) => ({
            id: person.id,
            email: person.email,
            name: person.nickname || person.full_name || person.email || "Member",
            removed: Boolean(person.membership_removed_at),
            hasResidualAccess:
              d.roles.some((role) => role.user_id === person.id) ||
              d.areas.some((area) => area.user_id === person.id),
          }))}
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
  recoveryMembers,
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
  recoveryMembers: {
    id: string;
    email: string | null;
    name: string;
    removed: boolean;
    hasResidualAccess: boolean;
  }[];
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("employee");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [recentLinks] = useState<Record<string, string>>({});
  const [recoveryBusyFor, setRecoveryBusyFor] = useState<string | null>(null);
  const [recoveryLinks, setRecoveryLinks] = useState<Record<string, string>>({});
  const sendInvitation = useServerFn(sendNativeInvitation);
  const create = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await sendInvitation({ data: { email: email.trim(), role } });
      toast.success("Invitation email requested. The member can set a password from the email link.");
      setEmail("");
      onChanged();
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
  const createRecoveryLink = async (member: (typeof recoveryMembers)[number]) => {
    if (!member.email || member.hasResidualAccess || recoveryReason.trim().length < 10) return;
    if (
      !confirm(
        `Create an explicit recovery invitation for ${member.email} as ${role}? Access remains blocked until this person accepts the link after confirming their email.`,
      )
    )
      return;

    setRecoveryBusyFor(member.id);
    try {
      const { token, hash } = await invitationToken();
      const { error } = await supabase.rpc("create_recovery_invitation", {
        _user_id: member.id,
        _token_hash: hash,
        _role: role,
        _areas: [],
        _reason: recoveryReason.trim(),
      });
      if (error) throw error;
      const link = `${window.location.origin}/auth#invite=${token}`;
      setRecoveryLinks((links) => ({ ...links, [member.id]: link }));
      const copied = await copyText(link);
      toast.success(
        copied
          ? "Recovery invitation created and link copied. Access remains blocked until acceptance."
          : "Recovery invitation created. Copy the one-time link below. Access remains blocked until acceptance.",
      );
      setRecoveryReason("");
      onChanged();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRecoveryBusyFor(null);
    }
  };
  return (
    <section className="mt-6 rounded-lg border bg-card p-5">
      <h2 className="font-medium">Invitations</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        New members receive an account invitation by email.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-0 basis-full flex-1 space-y-1 sm:basis-auto">
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
          Send invitation
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
              <span className="min-w-0 break-all">
                {item.email} · {item.role.replace(/^./, (letter) => letter.toUpperCase())}
                <span className="ml-2 text-xs text-muted-foreground">
                  expires {new Date(item.expires_at).toLocaleDateString()}
                </span>
              </span>
              {recentLinks[item.id] && (
                <Input
                  aria-label={`Invitation URL for ${item.email}`}
                  className="min-w-0 basis-full font-mono text-xs"
                  readOnly
                  value={recentLinks[item.id]}
                  onFocus={(event) => event.currentTarget.select()}
                />
              )}
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
                    void copyText(link).then((copied) =>
                      toast[copied ? "success" : "error"](
                        copied
                          ? "Invitation link copied"
                          : "Copy unavailable. Select the link below.",
                      ),
                    );
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
      {recoveryMembers.length > 0 && (
        <div className="mt-6 space-y-3 rounded-md border border-destructive/30 p-4">
          <div>
            <h3 className="font-medium">Explicit access recovery</h3>
            <p className="text-sm text-muted-foreground">
              A regular invitation cannot restore revoked access. A recovery invitation is audited
              and restores access only after the matching account verifies its email and accepts.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="recovery-reason">Reason for recovery</Label>
            <Input
              id="recovery-reason"
              value={recoveryReason}
              onChange={(event) => setRecoveryReason(event.target.value)}
              placeholder="Document the administrator-approved reason (10–500 characters)"
              maxLength={500}
            />
          </div>
          <div className="divide-y rounded-md border">
            {recoveryMembers.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{member.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{member.email}</p>
                  <p className="text-xs text-destructive">
                    {member.removed ? "Removed from Team & Access" : "Access revoked"}
                  </p>
                  {member.hasResidualAccess && (
                    <p className="text-xs text-destructive">
                      Roles or work areas remain assigned; resolve this inconsistency first.
                    </p>
                  )}
                </div>
                {recoveryLinks[member.id] ? (
                  <>
                    <Input
                      aria-label={`Recovery invitation URL for ${member.email}`}
                      className="min-w-0 basis-full font-mono text-xs"
                      readOnly
                      value={recoveryLinks[member.id]}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void copyText(recoveryLinks[member.id]!).then((copied) =>
                          toast[copied ? "success" : "error"](
                            copied ? "Recovery link copied" : "Copy unavailable. Select the link.",
                          ),
                        )
                      }
                    >
                      <Copy className="mr-1 h-4 w-4" /> Copy link
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      !member.email ||
                      member.hasResidualAccess ||
                      recoveryReason.trim().length < 10 ||
                      recoveryBusyFor !== null
                    }
                    onClick={() => void createRecoveryLink(member)}
                  >
                    {recoveryBusyFor === member.id ? "Creating…" : "Create recovery link"}
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Recovery does not restore previous roles or work areas. The selected role is granted
            only when the invitation is accepted. A removed member is shown separately from active
            Team & Access members.
          </p>
        </div>
      )}
    </section>
  );
}
