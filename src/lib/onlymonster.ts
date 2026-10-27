// Pure helpers for the OnlyMonster import (no I/O) — shared by server sync and tests.
export const OM_SOURCE = "onlymonster";
/** Statuses OnlyMonster uses for reversed/charged-back transactions. */
const VOID_STATUSES = new Set(["undo", "chargeback", "refunded", "refund", "reversed"]);

export interface OmTxn {
  id: string;
  amount: number;
  type?: string;
  status?: string;
  timestamp: string;
}

/** Calendar date in America/Bogota (UTC-5, no DST) for an ISO timestamp. */
export function bogotaDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return d.toISOString().slice(0, 10);
}

export function externalRef(platform: string, accountId: string, txnId: string) {
  return `om:${platform}:${accountId}:${txnId}`;
}

export function isVoidStatus(status: string | undefined | null) {
  return VOID_STATUSES.has(String(status ?? "").toLowerCase());
}

export interface MappedAccount {
  platform: string;
  platform_account_id: string;
  creator_id: string;
  agency_share_pct: number;
  currency: string;
}

/** Ledger row for one imported transaction. Gross amount as reported by OnlyMonster. */
export function toLedgerRow(t: OmTxn, acc: MappedAccount, chargedBack: boolean) {
  const voided = chargedBack || isVoidStatus(t.status);
  return {
    kind: "revenue" as const,
    amount: Math.round(Number(t.amount) * 100) / 100,
    currency: acc.currency,
    occurred_on: bogotaDate(t.timestamp),
    occurred_at: t.timestamp,
    category: "OnlyFans",
    description: t.type ?? null,
    creator_id: acc.creator_id,
    agency_share_pct: acc.agency_share_pct,
    external_ref: externalRef(acc.platform, acc.platform_account_id, t.id),
    source: OM_SOURCE,
    external_platform: acc.platform,
    external_account_id: acc.platform_account_id,
    external_status: chargedBack ? "chargeback" : (t.status ?? null),
    external_type: t.type ?? null,
    shared_with_creator: false,
    archived_at: voided ? new Date().toISOString() : null,
  };
}

/** Split [start,end] into windows of at most `days` days (API answers faster on narrow ranges). */
export function windows(start: Date, end: Date, days = 31): [string, string][] {
  const out: [string, string][] = [];
  let s = start.getTime();
  const e = end.getTime();
  while (s < e) {
    const n = Math.min(e, s + days * 86400_000);
    out.push([new Date(s).toISOString(), new Date(n).toISOString()]);
    s = n;
  }
  return out;
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
