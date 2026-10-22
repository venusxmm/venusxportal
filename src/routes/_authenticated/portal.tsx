import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TASK_STATUS_LABEL, useMe } from "@/lib/me";
import { money, summarize } from "@/lib/finance";
import { EmptyState, Loading, PageHeader, Pill, Stat, isOverdue } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/portal")({
  head: () => ({ meta: [{ title: "My Portal — VenusX" }] }),
  component: Portal,
});

function Portal() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const cid = me?.creatorId;
  const profile = useQuery({
    enabled: !!cid,
    queryKey: ["portal", "creator", cid],
    queryFn: async () => (await supabase.from("creators").select("stage_name,status,positioning,objectives").eq("id", cid!).single()).data,
  });
  const tasks = useQuery({
    enabled: !!cid,
    queryKey: ["tasks", "portal", cid],
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks").select("id,title,description,status,due_date,priority").eq("creator_id", cid!).eq("visible_to_creator", true).is("archived_at", null).order("due_date");
      if (error) throw error;
      return data;
    },
  });
  const fin = useQuery({
    enabled: !!cid,
    queryKey: ["transactions", "portal", cid],
    queryFn: async () => (await supabase.from("transactions").select("kind,amount,currency,occurred_on,agency_share_pct,archived_at").eq("creator_id", cid!).eq("shared_with_creator", true)).data ?? [],
  });
  const complete = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase.rpc("creator_set_task_status", { _task_id: id, _status: done ? "done" : "todo" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  if (!me) return <Loading />;
  if (!cid) return <EmptyState title="No creator profile linked" body="Ask the agency to add your email to your creator profile." />;
  const ts = tasks.data ?? [];
  const pct = ts.length ? Math.round((ts.filter((t) => t.status === "done").length / ts.length) * 100) : 0;
  const s = summarize(fin.data ?? []);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Hi, ${profile.data?.stage_name ?? ""}`} subtitle="Your next steps with VenusX." />
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between text-sm"><span>Roadmap progress</span><span className="text-gold">{pct}%</span></div>
        <Progress value={pct} className="mt-2" />
        {profile.data?.status && <p className="mt-3 text-xs text-muted-foreground">Stage: <span className="capitalize">{profile.data.status}</span></p>}
      </div>

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">My tasks</h2>
      {tasks.isLoading ? <Loading /> : ts.length === 0 ? <EmptyState title="You're all caught up" /> : (
        <div className="space-y-2">
          {ts.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border bg-card p-4">
              <div className="flex-1">
                <p className={t.status === "done" ? "text-muted-foreground line-through" : ""}>{t.title}</p>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                <p className={"mt-1 text-xs " + (isOverdue(t.due_date, t.status) ? "text-destructive" : "text-muted-foreground")}>{t.due_date ? `Due ${t.due_date}` : ""}</p>
              </div>
              <Pill value={t.status} label={TASK_STATUS_LABEL[t.status]} />
              <Button size="sm" variant={t.status === "done" ? "outline" : "default"} onClick={() => complete.mutate({ id: t.id, done: t.status !== "done" })}>
                {t.status === "done" ? "Undo" : "Done"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">My earnings</h2>
      {s.length === 0 ? <EmptyState title="Nothing shared yet" body="The agency will share your financial summaries here." /> : s.map((x) => (
        <div key={x.currency} className="grid grid-cols-2 gap-3">
          <Stat label={`Your share · ${x.currency}`} value={<span className="text-gold">{money(x.creatorRevenue, x.currency)}</span>} />
          <Stat label="Payouts" value={money(x.payouts, x.currency)} />
        </div>
      ))}
      <p className="mt-8 text-center text-xs text-muted-foreground">Academy, content submissions and messages are coming next.</p>
    </div>
  );
}
