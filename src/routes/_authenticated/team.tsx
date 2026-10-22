import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AREA_LABEL, AREA_ORDER, useMe, type AppRole, type WorkArea } from "@/lib/me";
import { EmptyState, Loading, PageHeader } from "@/components/portal";
import { Checkbox } from "@/components/ui/checkbox";

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
        supabase.from("profiles").select("id,full_name,email,created_at").order("created_at"),
        supabase.from("user_roles").select("user_id,role"),
        supabase.from("user_areas").select("user_id,area"),
      ]);
      if (p.error) throw p.error;
      return { people: p.data, roles: r.data ?? [], areas: a.data ?? [] };
    },
  });
  const toggleRole = useMutation({
    mutationFn: async ({ uid, role, on }: { uid: string; role: AppRole; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("user_roles").insert({ user_id: uid, role });
        if (error && !error.message.includes("duplicate")) throw error;
        return;
      }
      const { data, error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", role).select("id");
      if (error) throw new Error(error.message.includes("last executive") ? "You can't remove the last executive." : error.message);
      if (!data?.length) throw new Error("This change wasn't allowed. You can't remove your own executive role.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); qc.invalidateQueries({ queryKey: ["me"] }); toast.success("Access updated"); },
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
      const { data, error } = await supabase.from("user_areas").delete().eq("user_id", uid).eq("area", area).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Couldn't remove this area.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); qc.invalidateQueries({ queryKey: ["me"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!me?.isExec) return <EmptyState title="Restricted" body="Only executives manage access." />;
  if (data.isLoading) return <Loading />;
  const d = data.data!;
  return (
    <div>
      <PageHeader title="Team & Access" subtitle="People sign up themselves; you grant roles and work areas here. Every change is audited." />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-widest text-muted-foreground">
            <tr><th className="p-3">Person</th>{ROLES.map((r) => <th key={r} className="p-3 capitalize">{r}</th>)}<th className="p-3">Employee areas</th></tr>
          </thead>
          <tbody className="divide-y">
            {d.people.map((p) => {
              const has = (r: AppRole) => d.roles.some((x) => x.user_id === p.id && x.role === r);
              const isEmp = has("employee");
              return (
                <tr key={p.id}>
                  <td className="p-3"><p className="font-medium">{p.full_name || "—"}</p><p className="text-xs text-muted-foreground">{p.email}</p></td>
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
                    {isEmp ? <div className="flex flex-wrap gap-3">
                      {AREAS.map((a) => (
                        <label key={a} className="flex items-center gap-1 text-xs">
                          <Checkbox checked={d.areas.some((x) => x.user_id === p.id && x.area === a)} onCheckedChange={(v) => toggleArea.mutate({ uid: p.id, area: a, on: !!v })} />
                          {AREA_LABEL[a]}
                        </label>
                      ))}
                    </div> : <span className="text-xs text-muted-foreground">Select Employee to assign areas</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Creators are linked automatically when they sign up with the email on their creator profile. Partner access is reserved; no business areas are shared with partners yet.</p>
    </div>
  );
}
