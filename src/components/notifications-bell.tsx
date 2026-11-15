import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Creator-portal bell: syncs own task notifications, lists them, marks read (RLS: own rows only). */
export function NotificationsBell({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["notifications", userId],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      await supabase.rpc("sync_my_portal_notifications");
      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,body,read_at,created_at")
        .eq("user_id", userId)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });
  useEffect(() => {
    const t = setInterval(() => qc.invalidateQueries({ queryKey: ["notifications", userId] }), 5 * 60_000);
    return () => clearInterval(t);
  }, [qc, userId]);
  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", userId] }),
  });
  const items = list.data ?? [];
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Notificaciones (${items.length} sin leer)`}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-gold/40 text-gold"
      >
        <Bell className="h-5 w-5" />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-gold px-1 text-center text-[11px] font-semibold leading-5 text-primary-foreground">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-medium">Notificaciones</p>
          {items.length > 0 && (
            <button
              className="text-xs text-gold"
              onClick={() => markRead.mutate(items.map((n) => n.id))}
            >
              Marcar todo como leído
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tienes notificaciones nuevas.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  className="w-full border-b px-4 py-3 text-left last:border-0 hover:bg-accent"
                  onClick={() => markRead.mutate([n.id])}
                >
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
