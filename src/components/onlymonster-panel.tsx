import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mapOmAccount, refreshOmAccounts, syncOnlyMonster } from "@/lib/onlymonster.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function OnlyMonsterPanel({ creators }: { creators: { id: string; stage_name: string }[] }) {
  const qc = useQueryClient();
  const sync = useServerFn(syncOnlyMonster);
  const refresh = useServerFn(refreshOmAccounts);
  const map = useServerFn(mapOmAccount);

  const accounts = useQuery({
    queryKey: ["om", "accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("onlymonster_accounts").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  const lastRun = useQuery({
    queryKey: ["om", "lastRun"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_sync_runs")
        .select("*")
        .eq("provider", "onlymonster")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const runSync = useMutation({
    mutationFn: () => sync(),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Synced: ${r.inserted} new, ${r.updated} updated, ${r.voided} voided`)
        : toast.error(`Sync failed: ${r.error}`),
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => qc.invalidateQueries(),
  });
  const runRefresh = useMutation({
    mutationFn: () => refresh(),
    onSuccess: (r) => (r.ok ? toast.success(`${r.count} account(s) found`) : toast.error(r.error)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["om"] }),
  });

  const r = lastRun.data;
  return (
    <section className="mb-6 rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">OnlyMonster</h2>
          <p className="text-xs text-muted-foreground">
            {r
              ? `Last sync ${new Date(r.started_at).toLocaleString("en-US", { timeZone: "America/Bogota" })} · ${
                  r.ok == null ? "running" : r.ok ? "Connected" : `Error: ${r.error}`
                }`
              : "Never synced"}
            {" · "}Auto-sync every 30 min · amounts are gross generated revenue, not cash received
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={runRefresh.isPending} onClick={() => runRefresh.mutate()}>
            Find accounts
          </Button>
          <Button size="sm" disabled={runSync.isPending} onClick={() => runSync.mutate()}>
            {runSync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>
      {(accounts.data ?? []).map((a) => (
        <AccountRow key={a.id} a={a} creators={creators} onSave={(v) => map({ data: v }).then(() => qc.invalidateQueries({ queryKey: ["om"] }))} />
      ))}
    </section>
  );
}

function AccountRow({
  a,
  creators,
  onSave,
}: {
  a: { id: string; name: string | null; username: string | null; platform: string; creator_id: string | null; agency_share_pct: number | null };
  creators: { id: string; stage_name: string }[];
  onSave: (v: { id: string; creator_id: string | null; agency_share_pct: number | null }) => Promise<unknown>;
}) {
  const [creator, setCreator] = useState(a.creator_id ?? "none");
  const [pct, setPct] = useState(a.agency_share_pct == null ? "" : String(a.agency_share_pct));
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-2 text-sm">
      <span className="min-w-40">
        {a.name} <span className="text-muted-foreground">@{a.username} · {a.platform}</span>
      </span>
      <Select value={creator} onValueChange={setCreator}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not linked</SelectItem>
          {creators.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.stage_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input className="w-28" placeholder="Agency %" value={pct} onChange={(e) => setPct(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          const n = pct === "" ? null : Number(pct);
          if (creator !== "none" && (n == null || !(n >= 0 && n <= 100))) { toast.error("Enter the agency % (0–100) for this model's contract."); return; }
          setBusy(true);
          try {
            await onSave({ id: a.id, creator_id: creator === "none" ? null : creator, agency_share_pct: n });
            toast.success("Mapping saved");
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save
      </Button>
      {!a.creator_id && <span className="text-xs text-muted-foreground">Not imported until linked</span>}
    </div>
  );
}
