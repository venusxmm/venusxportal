import { describe, expect, it } from "vitest";
import { summarize, monthly } from "./finance";

describe("finance ledger math", () => {
  it("never combines different currencies", () => {
    const s = summarize([
      { kind: "revenue", amount: 100, currency: "USD", occurred_on: "2026-01-01" },
      { kind: "revenue", amount: 50, currency: "COP", occurred_on: "2026-01-01" },
    ]);
    expect(s.map((x) => [x.currency, x.revenue])).toEqual([["COP", 50], ["USD", 100]]);
  });

  it("splits revenue by agency share and computes net profit", () => {
    const s = summarize([
      { kind: "revenue", amount: 1000, currency: "USD", occurred_on: "2026-01-01", agency_share_pct: 40 },
      { kind: "expense", amount: 150, currency: "USD", occurred_on: "2026-01-02" },
    ])[0]!;
    expect(s.agencyRevenue).toBe(400);
    expect(s.creatorRevenue).toBe(600);
    expect(s.netProfit).toBe(250);
    expect(s.margin).toBeCloseTo(0.625);
  });

  it("excludes archived rows and avoids float drift", () => {
    const s = summarize([
      { kind: "revenue", amount: "0.10", currency: "USD", occurred_on: "2026-01-01" },
      { kind: "revenue", amount: "0.20", currency: "USD", occurred_on: "2026-01-01" },
      { kind: "revenue", amount: 999, currency: "USD", occurred_on: "2026-01-01", archived_at: "x" },
    ])[0]!;
    expect(s.revenue).toBe(0.3);
  });

  it("groups by month", () => {
    const m = monthly(
      [
        { kind: "revenue", amount: 10, currency: "USD", occurred_on: "2026-01-05" },
        { kind: "revenue", amount: 20, currency: "USD", occurred_on: "2026-02-05" },
      ],
      "USD",
    );
    expect(m.map((x) => [x.month, x.revenue])).toEqual([["2026-01", 10], ["2026-02", 20]]);
  });
});
