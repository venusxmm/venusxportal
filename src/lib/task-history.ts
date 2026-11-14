export type HistoryEvent = { id: string; action: string; body: string | null; actor_id: string | null; created_at: string };
export type HistoryKind = "comment" | "edit" | "status";
export type HistoryItem = { id: string; kind: HistoryKind; events: HistoryEvent[]; actor_id: string | null; created_at: string };

export const historyKind = (action: string): HistoryKind =>
  action === "comment" ? "comment" : action === "edited" || action === "rescheduled" ? "edit" : "status";

/** Newest first; merges edited+rescheduled saved by one person within 5s into one item. Never drops events. */
export function groupHistory(events: HistoryEvent[]): HistoryItem[] {
  const sorted = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const out: HistoryItem[] = [];
  for (const e of sorted) {
    const kind = historyKind(e.action);
    const last = out[out.length - 1];
    if (
      last && kind === "edit" && last.kind === "edit" && last.actor_id === e.actor_id &&
      !last.events.some((x) => x.action === e.action) &&
      Math.abs(Date.parse(last.created_at) - Date.parse(e.created_at)) <= 5000
    ) {
      last.events.push(e);
      continue;
    }
    out.push({ id: e.id, kind, events: [e], actor_id: e.actor_id, created_at: e.created_at });
  }
  return out;
}
