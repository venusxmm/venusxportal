import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, ErrorNote, Loading, PageHeader } from "@/components/portal";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Audit Log — VenusX Portal" }] }),
  component: Audit,
});

function Audit() {
  const q = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const [ev, people] = await Promise.all([
        supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(300),
        supabase.from("profiles").select("id,full_name,email"),
      ]);
      if (ev.error) throw ev.error;
      return { ev: ev.data, people: people.data ?? [] };
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} retry={() => q.refetch()} />;
  const who = (id: string | null) => { if (!id) return "System"; const p = q.data!.people.find((x) => x.id === id); return p?.full_name || p?.email || id.slice(0, 8); };
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Financial changes, access changes, creator changes and automation runs." />
      {q.data!.ev.length === 0 ? <EmptyState title="No events yet" /> : (
        <div className="divide-y rounded-lg border bg-card text-sm">
          {q.data!.ev.map((e) => (
            <div key={e.id} className="flex flex-wrap gap-3 px-4 py-3">
              <span className="w-40 text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
              <span className="w-40">{who(e.actor_id)}</span>
              <span className="text-gold">{e.entity}</span>
              <span className="capitalize">{e.action.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
