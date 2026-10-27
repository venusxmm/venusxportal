import { describe, expect, it } from "vitest";
import { bogotaDate, externalRef, periodRange, toLedgerRow, windows } from "./onlymonster";
import { summarize } from "./finance";

const acc = { platform: "onlyfans", platform_account_id: "1", creator_id: "c", agency_share_pct: 60, currency: "USD" };

describe("onlymonster import", () => {
  it("uses the Bogotá calendar date", () => {
    expect(bogotaDate("2026-10-27T03:00:00.000Z")).toBe("2026-10-26");
    expect(bogotaDate("2026-10-27T05:00:00.000Z")).toBe("2026-10-27");
  });
  it("keys rows by platform, account and transaction id", () => {
    expect(externalRef("onlyfans", "1", "abc")).toBe("om:onlyfans:1:abc");
  });
  it("voids chargebacks and undo status, keeps pending", () => {
    const t = { id: "a", amount: 10, status: "loading", timestamp: "2026-10-27T15:00:00Z" };
    expect(toLedgerRow(t, acc, false).archived_at).toBeNull();
    expect(toLedgerRow(t, acc, true).archived_at).not.toBeNull();
    expect(toLedgerRow({ ...t, status: "undo" }, acc, false).archived_at).not.toBeNull();
  });
  it("applies each model's own split", () => {
    const a = toLedgerRow({ id: "a", amount: 100, timestamp: "2026-10-27T15:00:00Z" }, acc, false);
    const b = toLedgerRow({ id: "b", amount: 100, timestamp: "2026-10-27T15:00:00Z" }, { ...acc, agency_share_pct: 40 }, false);
    expect(summarize([a, b])[0]).toMatchObject({ revenue: 200, agencyRevenue: 100, creatorRevenue: 100 });
  });
  it("computes quick periods", () => {
    expect(periodRange("yesterday", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(periodRange("week", "2026-10-27")).toEqual({ from: "2026-10-26", to: "2026-10-27" });
    expect(periodRange("lastMonth", "2026-10-27")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("last7", "2026-10-27")).toEqual({ from: "2026-10-21", to: "2026-10-27" });
  });
  it("splits sync ranges into windows", () => {
    expect(windows(new Date("2026-01-01"), new Date("2026-03-01"))).toHaveLength(2);
  });
});
