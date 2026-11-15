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
import { NotificationsBell } from "@/components/notifications-bell";
import { deadlineLabel } from "@/lib/portal-deadline";
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
        title="No hay un perfil de creadora vinculado"
        body="Si aceptaste una invitación, confirma que tu correo esté verificado y coincida con tu perfil. Si no, pide a la agencia que revise tu invitación."
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
  const statusEs = (t: Execution) =>
    ({ Completed: "Completada", Skipped: "Omitida", Overdue: "Vencida", Pending: "Pendiente" })[
      portalStatus(t)
    ] ?? portalStatus(t);
  const card = (t: Execution & { recurrence?: string; weekdays?: number[] }) => {
    const late = executionOverdue(t);
    const done = t.status === "done";
    const dl = t.scheduled_date ? deadlineLabel(t.scheduled_date, today) : null;
    const dot = done
      ? "bg-muted-foreground"
      : dl?.tone === "late" || late
        ? "bg-destructive"
        : dl?.tone === "today"
          ? "bg-gold"
          : dl?.tone === "soon"
            ? "bg-warning"
            : "bg-success";
    const relTone = done
      ? "text-muted-foreground"
      : dl?.tone === "late" || late
        ? "text-destructive"
        : dl?.tone === "today"
          ? "text-gold"
          : "text-foreground";
    const rec = t.recurring
      ? recurrenceLabel(t.recurrence ?? "daily", t.weekdays ?? [])
          .replace(/Every day|Daily/i, "Todos los días")
          .replace(/Weekdays/i, "Días seleccionados")
      : "";
    return (
      <div
        key={t.id}
        className={
          "flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start " +
          (late && !done ? "border-l-2 border-l-destructive" : "")
        }
      >
        <div className="min-w-0 flex-1 space-y-2">
          <p className={"break-words font-medium " + (done ? "text-muted-foreground line-through" : "")}>
            {t.title}
          </p>
          {dl && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className={"h-2 w-2 shrink-0 rounded-full " + dot} aria-hidden />
              <span className="text-foreground">{dl.full}</span>
              <span className="text-muted-foreground">·</span>
              <span className={"font-medium " + relTone}>{dl.rel}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t.due_time ? formatTime12(t.due_time) : "Sin hora"}
            {rec ? ` · ${rec}` : ""}
            {" · "}
            <span className={late && !done ? "text-destructive" : "text-gold"}>{statusEs(t)}</span>
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-gold">Ver detalles</summary>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {t.description || "Sin descripción"}
            </p>
          </details>
        </div>
        <Button
          size="sm"
          className="min-h-11 w-full shrink-0 sm:w-auto"
          variant={done ? "outline" : "default"}
          disabled={complete.isPending || t.status === "skipped"}
          onClick={() =>
            complete.mutate({
              id: t.id,
              done: !done,
              taskId: t.projected ? t.task_id : undefined,
              date: t.projected ? t.scheduled_date : undefined,
            })
          }
        >
          {done ? "Deshacer" : t.status === "skipped" ? "Omitida" : "Completar"}
        </Button>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`Hola, ${profile.data?.stage_name ?? ""}`}
        subtitle="Tus próximos pasos con VenusX."
        actions={<NotificationsBell userId={me.id} />}
      />
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span>Progreso</span>
          <span className="text-gold">{pct}%</span>
        </div>
        <Progress value={pct} className="mt-2" />
        {profile.data?.status && (
          <p className="mt-3 text-xs text-muted-foreground">
            Etapa:{" "}
            <span>
              {({ lead: "Prospecto", onboarding: "Incorporación", active: "Activa", paused: "En pausa", offboarded: "Finalizada" } as Record<string, string>)[profile.data.status] ?? profile.data.status}
            </span>
          </p>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">
        Mis tareas
      </h2>
      {tasks.isLoading ? (
        <Loading />
      ) : pending.length === 0 ? (
        <EmptyState title="¡Estás al día!" />
      ) : (
        <div className="space-y-2">{pending.map(card)}</div>
      )}
      {completed.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Completadas ({completed.length})
          </summary>
          <div className="mt-2 space-y-2">{completed.map(card)}</div>
        </details>
      )}

      <h2 className="mb-3 mt-8 text-sm uppercase tracking-widest text-muted-foreground">
        Mis ganancias
      </h2>
      {s.length === 0 ? (
        <EmptyState
          title="Aún no hay información"
          body="La agencia compartirá aquí tus resúmenes financieros."
        />
      ) : (
        s.map((x) => (
          <div key={x.currency} className="grid grid-cols-2 gap-3">
            <Stat
              label={`Tu parte · ${x.currency}`}
              value={<span className="text-gold">{money(x.creatorRevenue, x.currency)}</span>}
            />
            <Stat label="Pagos" value={money(x.payouts, x.currency)} />
          </div>
        ))
      )}
    </div>
  );
}
