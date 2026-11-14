import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/me";
import { money, summarize } from "@/lib/finance";
import { EmptyState, Loading, PageHeader, Stat } from "@/components/portal";
import { Button } from "@/components/ui/button";
import {
  agencyDate,
  executionOverdue,
  formatTime12,
  portalStatus,
  portalVisible,
  recurrenceLabel,
  shiftDate,
  sortPortalTasks,
  type Execution,
} from "@/lib/task-executions";
import { Progress } from "@/components/ui/progress";
import { useEffect } from "react";
import { msToNextMinute } from "@/lib/task-board";

export const Route = createFileRoute("/_authenticated/portal")({
  head: () => ({
    meta: [
      { title: "My Portal — VenusX Portal" },
      {
        name: "description",
        content: "View your assigned and explicitly shared VenusX executions and earnings.",
      },
      { property: "og:title", content: "My Portal — VenusX Portal" },
      {
        property: "og:description",
        content: "View your assigned and explicitly shared VenusX executions and earnings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const today = agencyDate();
      const { data, error } = await supabase.rpc("creator_portal_tasks", {
        _from: shiftDate(today, -7),
        _to: shiftDate(today, 14),
      });
      if (error) throw error;
      return data as unknown as (Execution & { recurrence?: string; weekdays?: number[] })[];
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
  useEffect(() => {
    // Refetch at the Bogotá day boundary so the next occurrence appears while the portal stays open.
    let day = agencyDate();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = agencyDate();
      if (next !== day) {
        day = next;
        qc.invalidateQueries({ queryKey: ["tasks", "portal"] });
      }
      timer = setTimeout(tick, msToNextMinute());
    };
    timer = setTimeout(tick, msToNextMinute());
    return () => clearTimeout(timer);
  }, [qc]);
  const complete = useMutation({
    mutationFn: async ({
      id,
      done,
      taskId,
      date,
    }: {
      id: string;
      done: boolean;
      taskId?: string | undefined;
      date?: string | null | undefined;
    }) => {
      const { error } =
        taskId && date
          ? await supabase.rpc("task_future_action", {
              _task_id: taskId,
              _date: date,
              _action: done ? "complete" : "reopen",
            })
          : await supabase.rpc("task_execution_action", {
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
  const today = agencyDate();
  const ts = sortPortalTasks(
    portalVisible(
      (tasks.data ?? []).filter((t) => t.visible_to_creator && t.owner_id === me.id),
      today,
    ),
  );
  const pending = ts.filter((t) => !["done", "skipped"].includes(t.status));
  const completed = ts.filter((t) => ["done", "skipped"].includes(t.status));
  const pct = ts.length ? Math.round((completed.length / ts.length) * 100) : 0;
  const s = summarize(fin.data ?? []);
  const deadlineBadge = (t: Execution) => {
    if (!t.scheduled_date) return null;
    const days = Math.round(
      (Date.parse(t.scheduled_date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000,
    );
    const readable = new Date(t.scheduled_date + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    const [dot, rel, tone] =
      days < 0
        ? ["🔴", `Overdue by ${-days} day${days === -1 ? "" : "s"}`, "border-destructive/50 text-destructive"]
        : days === 0
          ? ["🟠", "Today", "border-gold/60 text-gold"]
          : [
              "🟢",
              days === 1 ? "Tomorrow" : `In ${days} days`,
              "border-border text-muted-foreground",
            ];
    return (
      <span
        className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${tone}`}
      >
        <span aria-hidden>{dot}</span>
        {readable} · {rel}
      </span>
    );
  };
  const card = (t: Execution & { recurrence?: string; weekdays?: number[] }) => {
    const late = executionOverdue(t);
    const future = !!t.scheduled_date && t.scheduled_date > today;
    return (
      <div key={t.id} className="flex items-start gap-3 rounded-lg border bg-card p-4">
        <div className="min-w-0 flex-1">
          <p className={t.status === "done" ? "text-muted-foreground line-through" : ""}>
            {t.title}
          </p>
          {deadlineBadge(t)}
          <p className={"mt-1 text-xs " + (late ? "text-destructive" : "text-muted-foreground")}>
            {formatTime12(t.due_time)}
            {t.recurring ? ` · ${recurrenceLabel(t.recurrence ?? "daily", t.weekdays ?? [])}` : ""}
            {" · "}
            <span className={late ? "" : "text-gold"}>{portalStatus(t)}</span>
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-gold">View Details</summary>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {t.description || "No description"}
            </p>
          </details>
        </div>
        <Button
          size="sm"
          className="min-h-11"
          variant={t.status === "done" ? "outline" : "default"}
          disabled={complete.isPending || t.status === "skipped"}
          onClick={() =>
            complete.mutate({
              id: t.id,
              done: t.status !== "done",
              taskId: t.projected ? t.task_id : undefined,
              date: t.projected ? t.scheduled_date : undefined,
            })
          }
        >
          {t.status === "done" ? "Undo" : t.status === "skipped" ? "Skipped" : "Complete"}
        </Button>
      </div>
    );
  };

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
      ) : pending.length === 0 ? (
        <EmptyState title="You're all caught up" />
      ) : (
        <div className="space-y-2">{pending.map(card)}</div>
      )}
      {completed.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Completed ({completed.length})
          </summary>
          <div className="mt-2 space-y-2">{completed.map(card)}</div>
        </details>
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
    </div>
  );
}
