// Bogotá date helpers for Finance period filters.
/** Calendar date in America/Bogota (UTC-5, no DST) for an ISO timestamp. */
export function bogotaDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export type Period = "today" | "yesterday" | "last7" | "week" | "month" | "lastMonth" | "custom";

const addDays = (d: string, n: number) => {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Inclusive Bogotá date range for a quick period; `today` is a Bogotá YYYY-MM-DD. */
export function periodRange(p: Period, today: string): { from: string; to: string } {
  switch (p) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "week": {
      const dow = new Date(today + "T12:00:00Z").getUTCDay(); // 0 Sun
      return { from: addDays(today, -((dow + 6) % 7)), to: today };
    }
    case "month":
      return { from: today.slice(0, 8) + "01", to: today };
    case "lastMonth": {
      const first = today.slice(0, 8) + "01";
      const last = addDays(first, -1);
      return { from: last.slice(0, 8) + "01", to: last };
    }
    default:
      return { from: today, to: today };
  }
}
