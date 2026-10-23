import { describe, expect, it } from "vitest";
import { DEFAULT_AGENCY_SHARE_PCT, summarize, monthly, splitRevenue } from "./finance";

describe("finance ledger math", () => {
  it("never combines different currencies", () => {
    const s = summarize([
      { kind: "revenue", amount: 100, currency: "USD", occurred_on: "2026-01-01" },
      { kind: "revenue", amount: 50, currency: "COP", occurred_on: "2026-01-01" },
    ]);
    expect(s.map((x) => [x.currency, x.revenue])).toEqual([
      ["COP", 50],
      ["USD", 100],
    ]);
  });

  it("splits revenue by agency share and computes net profit", () => {
    const s = summarize([
      {
        kind: "revenue",
        amount: 1000,
        currency: "USD",
        occurred_on: "2026-01-01",
        agency_share_pct: 40,
      },
      { kind: "expense", amount: 150, currency: "USD", occurred_on: "2026-01-02" },
    ])[0]!;
    expect(s.agencyRevenue).toBe(400);
    expect(s.creatorRevenue).toBe(600);
    expect(s.netProfit).toBe(250);
    expect(s.margin).toBeCloseTo(0.625);
  });

  it("calculates the default agency share from the canonical 60 percent rule", () => {
    const summary = summarize([
      {
        kind: "revenue",
        amount: 100,
        currency: "USD",
        occurred_on: "2026-01-01",
        agency_share_pct: DEFAULT_AGENCY_SHARE_PCT,
      },
    ])[0]!;
    expect(summary.agencyRevenue).toBe(60);
    expect(summary.creatorRevenue).toBe(40);
  });

  it("uses the ledger's cent rounding for the form's revenue split preview", () => {
    expect(splitRevenue("100", DEFAULT_AGENCY_SHARE_PCT)).toEqual({
      agency: 60,
      creator: 40,
    });
    expect(splitRevenue("0.01", 50)).toEqual({ agency: 0.01, creator: 0 });
    expect(splitRevenue("1.20", "")).toBeNull();
    expect(splitRevenue("invalid", 60)).toBeNull();
  });

  it("excludes archived rows and avoids float drift", () => {
    const s = summarize([
      { kind: "revenue", amount: "0.10", currency: "USD", occurred_on: "2026-01-01" },
      { kind: "revenue", amount: "0.20", currency: "USD", occurred_on: "2026-01-01" },
      {
        kind: "revenue",
        amount: 999,
        currency: "USD",
        occurred_on: "2026-01-01",
        archived_at: "x",
      },
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
    expect(m.map((x) => [x.month, x.revenue])).toEqual([
      ["2026-01", 10],
      ["2026-02", 20],
    ]);
  });

  it("ignores archived rows in monthly totals and tolerates invalid agency share values", () => {
    const m = monthly(
      [
        { kind: "revenue", amount: 10, currency: "USD", occurred_on: "2026-01-05" },
        {
          kind: "revenue",
          amount: 25,
          currency: "USD",
          occurred_on: "2026-01-10",
          archived_at: "x",
        },
        {
          kind: "revenue",
          amount: 42,
          currency: "USD",
          occurred_on: "2026-02-05",
          agency_share_pct: "invalid",
        },
      ],
      "USD",
    );
    expect(m.map((x) => [x.month, x.revenue])).toEqual([
      ["2026-01", 10],
      ["2026-02", 42],
    ]);
    expect(
      summarize([
        {
          kind: "revenue",
          amount: "0.50",
          currency: "USD",
          occurred_on: "2026-03-01",
          agency_share_pct: "invalid",
        },
      ])[0],
    ).toMatchObject({
      revenue: 0.5,
      agencyRevenue: 0.5,
      creatorRevenue: 0,
    });
  });
});
