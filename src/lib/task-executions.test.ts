import { describe, expect, it } from "vitest";
import { agencyDate, appliesOn, canExecute, executionOverdue, scheduledFor, shiftDate, type Execution } from "./task-executions";
const task: Execution = { id: "a", task_id: "a", title: "Task", description: null, owner_id: "owner", creator_id: null, priority: "medium", scheduled_date: "2026-10-25", due_time: "09:00", status: "todo", recurring: true, skip_state: "none" };
describe("Bogota dated execution rules", () => {
  it("uses America/Bogota across UTC midnight", () => expect(agencyDate(new Date("2026-10-26T02:00:00Z"))).toBe("2026-10-25"));
  it("does not show future work on today's schedule", () => expect(scheduledFor({ ...task, scheduled_date: "2026-10-26" }, "2026-10-25")).toBe(false));
  it("never automatically marks no-time work overdue", () => expect(executionOverdue({ ...task, due_time: null }, new Date("2026-11-01T00:00:00Z"))).toBe(false));
  it("marks a timed incomplete execution overdue only after its Bogota deadline", () => {
    expect(executionOverdue(task, new Date("2026-10-25T13:59:00Z"))).toBe(false);
    expect(executionOverdue(task, new Date("2026-10-25T14:01:00Z"))).toBe(true);
    expect(executionOverdue({ ...task, status: "done" }, new Date("2026-10-25T14:01:00Z"))).toBe(false);
  });
  it("distinguishes one-time, daily and selected weekdays", () => {
    expect(appliesOn("once", [], "2026-10-25", "2026-10-26")).toBe(false);
    expect(appliesOn("daily", [], "2026-10-25", "2026-10-26")).toBe(true);
    expect(appliesOn("weekdays", [1, 3], "2026-10-25", "2026-10-26")).toBe(true);
    expect(appliesOn("weekdays", [1, 3], "2026-10-25", "2026-10-27")).toBe(false);
  });
  it("allows owners and executives, not other members or unassigned users", () => {
    expect(canExecute(task, "owner", false)).toBe(true);
    expect(canExecute(task, "other", false)).toBe(false);
    expect(canExecute({ ...task, owner_id: null }, "other", false)).toBe(false);
    expect(canExecute(task, "other", true)).toBe(true);
    expect(canExecute({ ...task, projected: true }, "owner", false)).toBe(false);
  });
  it("navigates dates without device timezone drift", () => expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01"));
});