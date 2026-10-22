import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string | undefined }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Loading() {
  return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 p-4 text-sm">
      <p className="text-destructive">{(error as Error)?.message ?? "Something went wrong."}</p>
      {retry && (
        <button onClick={retry} className="mt-2 underline">
          Retry
        </button>
      )}
    </div>
  );
}

const tone: Record<string, string> = {
  done: "border-success/40 text-success",
  active: "border-success/40 text-success",
  blocked: "border-destructive/40 text-destructive",
  critical: "border-destructive/40 text-destructive",
  high: "border-warning/40 text-warning",
  onboarding: "border-gold/40 text-gold",
  in_progress: "border-gold/40 text-gold",
  review: "border-gold/40 text-gold",
  revenue: "border-success/40 text-success",
  expense: "border-destructive/40 text-destructive",
};

export function Pill({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal capitalize", tone[value])}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

export const isOverdue = (due: string | null, status: string) =>
  !!due && status !== "done" && due < new Date().toISOString().slice(0, 10);
