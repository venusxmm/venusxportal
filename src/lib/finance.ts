export type LedgerKind = "revenue" | "expense" | "payout";
export const DEFAULT_AGENCY_SHARE_PCT = 60;

export interface LedgerRow {
  kind: LedgerKind;
  amount: number | string;
  currency: string;
  occurred_on: string; // YYYY-MM-DD
  agency_share_pct?: number | string | null;
  archived_at?: string | null;
}

export interface CurrencySummary {
  currency: string;
  revenue: number;
  expenses: number;
  payouts: number;
  /** Agency's portion of revenue (uses agency_share_pct, defaults to 100%). */
  agencyRevenue: number;
  /** Creator's portion of revenue. */
  creatorRevenue: number;
  /** agencyRevenue - expenses */
  netProfit: number;
  /** netProfit / agencyRevenue, or null when there is no agency revenue */
  margin: number | null;
}

const cents = (n: number | string) => Math.round(Number(n) * 100);
const parseAgencyShare = (value: number | string | null | undefined) => {
  if (value == null || value === "") return 100;
  const pct = Number(value);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 100;
};

/**
 * Single source of truth for ledger math. Never mixes currencies:
 * returns one summary per currency. Archived rows are excluded.
 */
export function summarize(rows: LedgerRow[]): CurrencySummary[] {
  const map = new Map<string, { rev: number; exp: number; pay: number; agency: number }>();
  for (const r of rows) {
    if (r.archived_at) continue;
    const cur = String(r.currency ?? "").toUpperCase();
    if (!cur) continue;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount)) continue;
    const acc = map.get(cur) ?? { rev: 0, exp: 0, pay: 0, agency: 0 };
    const c = cents(amount);
    if (r.kind === "revenue") {
      acc.rev += c;
      const pct = parseAgencyShare(r.agency_share_pct);
      acc.agency += Math.round((c * pct) / 100);
    } else if (r.kind === "expense") acc.exp += c;
    else acc.pay += c;
    map.set(cur, acc);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, a]) => {
      const net = a.agency - a.exp;
      return {
        currency,
        revenue: a.rev / 100,
        expenses: a.exp / 100,
        payouts: a.pay / 100,
        agencyRevenue: a.agency / 100,
        creatorRevenue: (a.rev - a.agency) / 100,
        netProfit: net / 100,
        margin: a.agency === 0 ? null : net / a.agency,
      };
    });
}

export function inRange<T extends LedgerRow>(rows: T[], from?: string, to?: string): T[] {
  return rows.filter((r) => (!from || r.occurred_on >= from) && (!to || r.occurred_on <= to));
}

export function monthly(rows: LedgerRow[], currency: string) {
  const months = new Map<string, LedgerRow[]>();
  const targetCurrency = currency.toUpperCase();
  for (const r of rows) {
    if (r.archived_at) continue;
    if (String(r.currency ?? "").toUpperCase() !== targetCurrency) continue;
    const m = r.occurred_on.slice(0, 7);
    months.set(m, [...(months.get(m) ?? []), r]);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rs]) => ({ month, ...(summarize(rs)[0] ?? emptySummary(currency)) }));
}

function emptySummary(currency: string): CurrencySummary {
  return {
    currency,
    revenue: 0,
    expenses: 0,
    payouts: 0,
    agencyRevenue: 0,
    creatorRevenue: 0,
    netProfit: 0,
    margin: null,
  };
}

export function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
