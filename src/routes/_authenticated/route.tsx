import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, type Me } from "@/lib/me";
import { Loading } from "@/components/portal";
import logo from "@/assets/venusx-logo.jpeg.asset.json";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Shell,
});

type NavItem = { to: "/dashboard" | "/portal" | "/creators" | "/tasks" | "/finance" | "/team" | "/audit" | "";  label: string; show: (m: Me) => boolean; soon?: boolean };
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Overview", show: () => true },
  { to: "/portal", label: "My Portal", show: (m) => m.isCreator },
  { to: "/creators", label: "Creators", show: (m) => m.isStaff },
  { to: "/tasks", label: "Tasks", show: (m) => m.isStaff },
  { to: "/finance", label: "Finance", show: (m) => m.isExec },
  { to: "/team", label: "Team & Access", show: (m) => m.isExec },
  { to: "/audit", label: "Audit Log", show: (m) => m.isExec },
  { to: "", label: "Marketing · VXRDOS", show: (m) => m.isStaff, soon: true },
  { to: "", label: "Chatting", show: (m) => m.isStaff, soon: true },
  { to: "", label: "Academy", show: () => true, soon: true },
  { to: "", label: "VenusX Credits", show: (m) => m.isStaff, soon: true },
  { to: "", label: "Consigliere", show: (m) => m.isExec, soon: true },
];

function Shell() {
  const { data: me, isLoading } = useMe();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading || !me) return <Loading />;
  const items = NAV.filter((n) => n.show(me));

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((n) =>
        n.soon ? (
          <span key={n.label} className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60" title="Not available yet">
            {n.label}
            <span className="text-[10px] uppercase tracking-widest">Soon</span>
          </span>
        ) : (
          <Link
            key={n.label}
            to={n.to as "/dashboard"}
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            activeProps={{ className: "bg-sidebar-accent text-gold font-medium" }}
          >
            {n.label}
          </Link>
        ),
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-sidebar-border bg-sidebar p-4 transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-8 flex items-center gap-3 px-2">
          <img src={logo.url} alt="" className="h-9 w-9 rounded-full" />
          <span className="font-semibold tracking-wide">
            Venus<span className="text-gold">X</span>
          </span>
          <button className="ml-auto md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        {nav}
        <div className="absolute inset-x-4 bottom-4 border-t border-sidebar-border pt-4 text-sm">
          <p className="truncate font-medium">{me.name ?? me.email}</p>
          <p className="truncate text-xs capitalize text-muted-foreground">{me.roles.join(", ") || "No role yet"}</p>
          <button onClick={signOut} className="mt-2 text-xs text-muted-foreground hover:text-gold">
            Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-background/70 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">
            Venus<span className="text-gold">X</span>
          </span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
