import { describe, expect, it } from "vitest";
import { compareExecutions, type Execution } from "./task-executions";
const e = (o: Partial<Execution>) => ({ id: "x", task_id: "t", title: "A", scheduled_date: "2026-11-10", due_time: null, ...o }) as Execution;
describe("manual task order", () => {
  it("manual order beats time", () => {
    const rows = [e({ id: "a", due_time: "06:00", sort_order: 2 }), e({ id: "b", due_time: "15:00", sort_order: 1 })].sort(compareExecutions);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("unordered tasks fall back to time", () => {
    const rows = [e({ id: "a", due_time: "15:00" }), e({ id: "b", due_time: "06:00" })].sort(compareExecutions);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
