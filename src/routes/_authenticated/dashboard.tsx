import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/me";
import { summarize, money } from "@/lib/finance";
import { EmptyState, Loading, PageHeader, Pill, Stat, isOverdue } from "@/components/portal";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview — VenusX Portal" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: me } = useMe();
  if (!me) return <Loading />;
  if (me.roles.length === 0) return <Setup />;
  if (!me.isStaff && me.isCreator) return <CreatorRedirect />;
  return <StaffOverview />;
}

function CreatorRedirect() {
  return (
    <div>
      <PageHeader title="Welcome" subtitle="Your personal space lives in My Portal." />
      <Link to="/portal">
        <Button>Open My Portal</Button>
      </Link>
    </div>
  );
}

function Setup() {
  const qc = useQueryClient();
  const exists = useQuery({
    queryKey: ["executives_exist"],
    queryFn: async () => (await supabase.rpc("executives_exist")).data ?? true,
  });
  const claim = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("claim_first_executive");
      if (error) throw error;
      if (!data) throw new Error("An executive already exists.");
    },
    onSuccess: () => {
      toast.success("You are now the first executive.");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (exists.isLoading) return <Loading />;
  return (
    <div className="mx-auto max-w-lg py-16">
      {exists.data === false ? (
        <EmptyState
          title="First-run setup"
          body="No executive account exists yet. Claim the first executive seat for this account; you can then invite the second executive from Team & Access."
          action={
            <Button onClick={() => claim.mutate()} disabled={claim.isPending}>
              Become first executive
            </Button>
          }
        />
      ) : (
        <EmptyState
          title="Waiting for access"
          body="Your account exists, but an executive still needs to assign you a role. Ask Ángel or Daniela to grant access in Team & Access."
        />
      )}
    </div>
  );
}

function StaffOverview() {
  const { data: me } = useMe();
  const tasks = useQuery({
    queryKey: ["tasks", "overview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id,title,status,priority,due_date,owner_id,creators(stage_name)")
        .is("archived_at", null)
        .neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const creators = useQuery({
    queryKey: ["creators", "count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creators")
        .select("status")
        .is("archived_at", null);
      if (error) throw error;
      return data;
    },
  });
  const month = new Date().toISOString().slice(0, 7);
  const txns = useQuery({
    enabled: !!me?.isExec,
    queryKey: ["transactions", "month", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "kind,amount,currency,occurred_on,agency_share_pct,deduct_from_agency_cut,archived_at",
        )
        .gte("occurred_on", month + "-01");
      if (error) throw error;
      return data;
    },
  });

  const all = tasks.data ?? [];
  const mine = all.filter((t) => t.owner_id === me?.id);
  const overdue = all.filter((t) => isOverdue(t.due_date, t.status));
  const critical = all.filter((t) => t.priority === "critical");
  const list = me?.isExec ? all : mine;
  const fin = summarize(txns.data ?? []);

  return (
    <div>
      <PageHeader
        title={`Good to see you${me?.name ? ", " + me.name.split(" ")[0] : ""}`}
        subtitle="Live view from your agency records."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Active creators"
          value={creators.data?.filter((c) => c.status === "active").length ?? "—"}
        />
        <Stat
          label="Onboarding"
          value={creators.data?.filter((c) => c.status === "onboarding").length ?? "—"}
        />
        <Stat label="Overdue tasks" value={overdue.length} />
        <Stat label="Critical open" value={critical.length} />
      </div>

      {me?.isExec && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">
            This month
          </h2>
          {fin.length === 0 ? (
            <EmptyState
              title="No financial records this month"
              body="Add revenue and expenses in Finance to see results here."
            />
          ) : (
            fin.map((s) => (
              <div key={s.currency} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label={`Revenue · ${s.currency}`} value={money(s.revenue, s.currency)} />
                <Stat
                  label="Expenses"
                  value={money(s.expenses, s.currency)}
                  hint={`${money(s.deductibleExpenses, s.currency)} deducted from agency cut`}
                />
                <Stat label="Agency share" value={money(s.agencyRevenue, s.currency)} />
                <Stat
                  label="Net profit"
                  value={<span className="text-gold">{money(s.netProfit, s.currency)}</span>}
                  hint={s.margin == null ? undefined : `${(s.margin * 100).toFixed(1)}% margin`}
                />
              </div>
            ))
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">
          {me?.isExec ? "Open priorities" : "My assignments"}
        </h2>
        {tasks.isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <EmptyState title="Nothing open" body="Create tasks in the Tasks area." />
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {list.slice(0, 10).map((t) => (
              <Link
                key={t.id}
                to="/tasks"
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent"
              >
                <span className="flex-1 truncate">{t.title}</span>
                {t.creators?.stage_name && (
                  <span className="hidden text-muted-foreground sm:inline">
                    {t.creators.stage_name}
                  </span>
                )}
                <Pill value={t.priority} />
                <span
                  className={
                    isOverdue(t.due_date, t.status) ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {t.due_date ?? "—"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
