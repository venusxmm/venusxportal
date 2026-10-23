import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENCY_SHARE_PCT,
  summarize,
  monthly,
  splitRevenue,
  summarizeCreatorBalances,
  validateTransactionCreator,
} from "./finance";

describe("finance ledger math", () => {
  it("requires an explicitly selected creator for payouts", () => {
    expect(validateTransactionCreator("payout", null)).toMatch(/select the creator/i);
    expect(validateTransactionCreator("payout", "creator-id")).toBeNull();
    expect(validateTransactionCreator("expense", null)).toBeNull();
  });

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
    expect(s.creatorBalance).toBe(600);
    expect(s.deductibleExpenses).toBe(150);
    expect(s.netProfit).toBe(250);
    expect(s.margin).toBeCloseTo(0.625);
  });

  it("deducts only opted-in expenses from agency net profit, once and per currency", () => {
    const summary = summarize([
      {
        kind: "revenue",
        amount: 1000,
        currency: "USD",
        occurred_on: "2026-01-01",
        agency_share_pct: 40,
      },
      {
        kind: "expense",
        amount: 100,
        currency: "USD",
        occurred_on: "2026-01-02",
        deduct_from_agency_cut: true,
      },
      {
        kind: "expense",
        amount: 60,
        currency: "USD",
        occurred_on: "2026-01-03",
        deduct_from_agency_cut: false,
      },
      {
        kind: "expense",
        amount: 5,
        currency: "EUR",
        occurred_on: "2026-01-04",
        deduct_from_agency_cut: false,
      },
    ]);

    expect(summary).toMatchObject([
      { currency: "EUR", expenses: 5, deductibleExpenses: 0, agencyRevenue: 0, netProfit: 0 },
      {
        currency: "USD",
        expenses: 160,
        deductibleExpenses: 100,
        agencyRevenue: 400,
        netProfit: 300,
        margin: 0.75,
      },
    ]);
  });

  it("defaults legacy and unconfigured expenses to deducting from agency cut", () => {
    const [summary] = summarize([
      { kind: "revenue", amount: 100, currency: "USD", occurred_on: "2026-01-01" },
      { kind: "expense", amount: 10, currency: "USD", occurred_on: "2026-01-02" },
      {
        kind: "expense",
        amount: 5,
        currency: "USD",
        occurred_on: "2026-01-03",
        deduct_from_agency_cut: null,
      },
    ]);

    expect(summary).toMatchObject({ expenses: 15, deductibleExpenses: 15, netProfit: 85 });
  });

  it("deducts each non-voided payout once from the creator balance, per currency", () => {
    const summary = summarize([
      {
        kind: "revenue",
        amount: "100.00",
        currency: "USD",
        occurred_on: "2026-10-01",
        agency_share_pct: 60,
      },
      { kind: "payout", amount: "10.25", currency: "USD", occurred_on: "2026-10-02" },
      {
        kind: "payout",
        amount: "99.00",
        currency: "USD",
        occurred_on: "2026-10-03",
        archived_at: "2026-10-04T00:00:00Z",
      },
      { kind: "payout", amount: "5.00", currency: "EUR", occurred_on: "2026-10-03" },
    ]);

    expect(summary).toMatchObject([
      { currency: "EUR", payouts: 5, creatorBalance: -5 },
      { currency: "USD", payouts: 10.25, creatorRevenue: 40, creatorBalance: 29.75 },
    ]);
  });

  it("calculates balances independently for each creator and currency", () => {
    const balances = summarizeCreatorBalances([
      {
        kind: "revenue",
        amount: 100,
        currency: "USD",
        occurred_on: "2026-10-01",
        agency_share_pct: 60,
        creator_id: "creator-a",
      },
      {
        kind: "payout",
        amount: 20,
        currency: "USD",
        occurred_on: "2026-10-02",
        creator_id: "creator-a",
      },
      {
        kind: "revenue",
        amount: 100,
        currency: "USD",
        occurred_on: "2026-10-01",
        agency_share_pct: 20,
        creator_id: "creator-b",
      },
      {
        kind: "payout",
        amount: 10,
        currency: "EUR",
        occurred_on: "2026-10-02",
        creator_id: "creator-b",
      },
      {
        kind: "payout",
        amount: 99,
        currency: "USD",
        occurred_on: "2026-10-03",
        creator_id: "creator-a",
        archived_at: "2026-10-04T00:00:00Z",
      },
    ]);

    expect(balances).toEqual([
      { creatorId: "creator-a", currency: "USD", creatorRevenue: 40, payouts: 20, balance: 20 },
      { creatorId: "creator-b", currency: "EUR", creatorRevenue: 0, payouts: 10, balance: -10 },
      { creatorId: "creator-b", currency: "USD", creatorRevenue: 80, payouts: 0, balance: 80 },
    ]);
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
