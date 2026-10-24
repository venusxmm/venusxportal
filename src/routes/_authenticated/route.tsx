import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Menu, Settings, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, type Me } from "@/lib/me";
import { EmptyState, Loading } from "@/components/portal";
import { cn } from "@/lib/utils";
import { APP_VERSION_LABEL } from "@/lib/version";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData, error } = await supabase.auth.getSession();
    if (error || !sessionData.session) {
      throw redirect({ to: "/auth" });
    }
    const { data: isActiveMember, error: memberError } = await supabase.rpc("is_active_member", {
      _user_id: sessionData.session.user.id,
    });
    if (memberError) throw memberError;
    if (!isActiveMember) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      throw redirect({ to: "/auth" });
    }
  },
  component: Shell,
});

type NavItem = {
  to: "/dashboard" | "/portal" | "/creators" | "/tasks" | "/finance" | "/team" | "/audit" | "";
  label: string;
  show: (m: Me) => boolean;
  soon?: boolean;
};
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Overview", show: () => true },
  { to: "/portal", label: "My Portal", show: (m) => m.isCreator },
  { to: "/creators", label: "Creators", show: (m) => m.isStaff },
  { to: "/tasks", label: "Tasks", show: (m) => m.isStaff },
  { to: "/finance", label: "Finance", show: (m) => m.isExec },
  { to: "/team", label: "Team & Access", show: (m) => m.isExec },
  { to: "/audit", label: "Audit Log", show: (m) => m.isExec },
  { to: "", label: "Marketing", show: (m) => m.isStaff, soon: true },
  { to: "", label: "Chatting", show: (m) => m.isStaff, soon: true },
  { to: "", label: "Academy", show: () => true, soon: true },
  { to: "", label: "VenusX Credits", show: (m) => m.isStaff, soon: true },
  { to: "", label: "Consigliere", show: (m) => m.isExec, soon: true },
];

function Shell() {
  const { data: me, isLoading, error } = useMe();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading) return <Loading />;
  if (error)
    return (
      <EmptyState
        title="Account access could not be resolved"
        body={`${error.message} If the issue continues, ask an Executive to review your account and Creator invitation.`}
      />
    );
  if (!me) return <Loading />;
  const items = NAV.filter((n) => n.show(me));

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((n) =>
        n.soon ? (
          <span
            key={n.label}
            className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/60"
            title="Not available yet"
          >
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
          <img src="/venusx-logo.jpeg" alt="" className="h-9 w-9 rounded-full" />
          <span className="text-lg font-bold uppercase tracking-[0.3em] text-gold-gradient">
            VenusX
          </span>
          <button
            className="ml-auto md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {nav}
        <div className="absolute inset-x-4 bottom-4 border-t border-sidebar-border pt-4 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{me.name ?? me.email}</p>
              <p className="truncate text-xs capitalize text-muted-foreground">
                {me.roles.join(", ") || "No role yet"}
              </p>
            </div>
            <Link
              to="/settings"
              className="rounded-md border border-sidebar-border p-1.5 text-muted-foreground transition-colors hover:border-gold/70 hover:text-gold"
              aria-label="Open settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button onClick={signOut} className="text-xs text-muted-foreground hover:text-gold">
              Sign out
            </button>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {APP_VERSION_LABEL}
            </span>
          </div>
        </div>
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-background/70 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-lg font-bold uppercase tracking-[0.3em] text-gold-gradient">
            VenusX
          </span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
