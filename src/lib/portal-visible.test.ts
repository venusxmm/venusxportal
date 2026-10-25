import { describe, expect, it } from "vitest";
import { portalVisible, shiftDate } from "./task-executions";
const today = "2026-10-25";
const row = (d: string, extra = {}) => ({ id: d, recurring: true, scheduled_date: d, ...extra });
describe("portalVisible", () => {
  it("daily task done today plus 14 future placeholders shows once", () => {
    const rows = [row(today, { status: "done" }), ...Array.from({ length: 14 }, (_, i) => row(shiftDate(today, i + 1), { projected: true }))];
    expect(portalVisible(rows, today)).toHaveLength(1);
  });
  it("keeps future one-time tasks and overdue past recurring rows", () => {
    expect(portalVisible([row("2026-10-30", { recurring: false }), row("2026-10-20")], today)).toHaveLength(2);
  });
});
