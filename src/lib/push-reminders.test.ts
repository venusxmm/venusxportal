import { describe, expect, it } from "vitest";
import { computeReminders, inQuiet } from "./push-reminders";

const b = (s: string) => new Date(s + "-05:00");

describe("computeReminders", () => {
  it("sends three spread reminders for a week-long task", () => {
    const r = computeReminders(b("2026-11-02T10:00:00"), b("2026-11-09T10:00:00"));
    expect(r.map((x) => x.n)).toEqual([1, 2, 3]);
    expect(r[2]!.at.getTime()).toBe(b("2026-11-09T08:00:00").getTime());
  });
  it("sends only the final reminder when less than 3 hours remain", () => {
    const r = computeReminders(b("2026-11-02T10:00:00"), b("2026-11-02T12:00:00"));
    expect(r.map((x) => x.n)).toEqual([3]);
  });
  it("sends at most two reminders for a same-day task", () => {
    const r = computeReminders(b("2026-11-02T09:00:00"), b("2026-11-02T19:00:00"));
    expect(r.map((x) => x.n)).toEqual([2, 3]);
  });
  it("never schedules inside quiet hours 21:00–08:00", () => {
    const r = computeReminders(b("2026-11-01T22:00:00"), b("2026-11-30T23:59:00"));
    for (const x of r) expect(inQuiet(x.at, 21, 8)).toBe(false);
  });
  it("returns nothing when the deadline already passed", () => {
    expect(computeReminders(b("2026-11-02T10:00:00"), b("2026-11-01T10:00:00"))).toEqual([]);
  });
  it("keeps reminders at least one hour apart", () => {
    const r = computeReminders(b("2026-11-02T08:00:00"), b("2026-11-03T08:30:00"));
    for (let i = 1; i < r.length; i++)
      expect(r[i]!.at.getTime() - r[i - 1]!.at.getTime()).toBeGreaterThanOrEqual(3600_000);
  });
});
