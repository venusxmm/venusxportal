import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/me";
import { money, summarize } from "@/lib/finance";
import { EmptyState, Loading, PageHeader, Pill, Stat } from "@/components/portal";
import { Button } from "@/components/ui/button";
import { agencyDate, executionOverdue, type Execution } from "@/lib/task-executions";
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
    queryFn: async () => {
      if (!cid) return null;
      return (
        await supabase
          .from("creators")
          .select("stage_name,status,positioning,objectives")
          .eq("id", cid)
          .single()
      ).data;
    },
  });
  const tasks = useQuery({
    enabled: !!cid,
    queryKey: ["tasks", "portal", cid],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("task_agenda", { _date: agencyDate() });
      if (error) throw error;
      return (data as unknown as Execution[]).filter(
        (t) =>
          !t.archived_at &&
          !t.projected &&
          (t.scheduled_date === agencyDate() || executionOverdue(t) || !t.scheduled_date),
      );
    },
  });
  const fin = useQuery({
    enabled: !!cid,
    queryKey: ["transactions", "portal", cid],
    queryFn: async () => {
      if (!cid) return [];
      return (
        (
          await supabase
            .from("transactions")
            .select(
              "kind,amount,currency,occurred_on,agency_share_pct,deduct_from_agency_cut,archived_at",
            )
            .eq("creator_id", cid)
            .eq("shared_with_creator", true)
        ).data ?? []
      );
    },
  });
  const complete = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      const { error } = await supabase.rpc("task_execution_action", {
        _id: id,
        _action: done ? "complete" : "reopen",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  if (!me) return <Loading />;
  if (!cid)
    return (
      <EmptyState
        title="No creator profile linked"
        body="If you accepted a Creator invitation, confirm that your email is verified and matches one active Creator profile. Otherwise, ask an Executive to verify the Creator email and invitation. Access is not granted until the association is confirmed."
      />
    );
  const ts = tasks.data ?? [];
  const pct = ts.length
    ? Math.round((ts.filter((t) => t.status === "done").length / ts.length) * 100)
    : 0;
  const s = summarize(fin.data ?? []);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Hi, ${profile.data?.stage_name ?? ""}`}
        subtitle="Your next steps with VenusX."
      />
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span>Roadmap progress</span>
          <span className="text-gold">{pct}%</span>
        </div>
        <Progress value={pct} className="mt-2" />
        {profile.data?.status && (
          <p className="mt-3 text-xs text-muted-foreground">
            Stage: <span className="capitalize">{profile.data.status}</span>
          </p>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">
        My tasks
      </h2>
      {tasks.isLoading ? (
        <Loading />
      ) : ts.length === 0 ? (
        <EmptyState title="You're all caught up" />
      ) : (
        <div className="space-y-2">
          {ts.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border bg-card p-4">
              <div className="flex-1">
                <p className={t.status === "done" ? "text-muted-foreground line-through" : ""}>
                  {t.title}
                </p>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                <p
                  className={
                    "mt-1 text-xs " +
                    (executionOverdue(t) ? "text-destructive" : "text-muted-foreground")
                  }
                >
                  {t.scheduled_date ? `Due ${t.scheduled_date}` : ""}
                </p>
              </div>
              <Pill value={t.status} label={t.status.replaceAll("_", " ")} />
              <Button
                size="sm"
                variant={t.status === "done" ? "outline" : "default"}
                onClick={() => complete.mutate({ id: t.id, done: t.status !== "done" })}
              >
                {t.status === "done" ? "Undo" : "Done"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">
        My earnings
      </h2>
      {s.length === 0 ? (
        <EmptyState
          title="Nothing shared yet"
          body="The agency will share your financial summaries here."
        />
      ) : (
        s.map((x) => (
          <div key={x.currency} className="grid grid-cols-2 gap-3">
            <Stat
              label={`Your share · ${x.currency}`}
              value={<span className="text-gold">{money(x.creatorRevenue, x.currency)}</span>}
            />
            <Stat label="Payouts" value={money(x.payouts, x.currency)} />
          </div>
        ))
      )}
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Academy, content submissions and messages are coming next.
      </p>
    </div>
  );
}
