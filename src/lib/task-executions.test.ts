import { describe, expect, it } from "vitest";
import {
  agencyDate,
  appliesOn,
  canExecute,
  executionOverdue,
  scheduledFor,
  shiftDate,
  type Execution,
} from "./task-executions";
const task: Execution = {
  id: "a",
  task_id: "a",
  title: "Task",
  description: null,
  owner_id: "owner",
  creator_id: null,
  priority: "medium",
  scheduled_date: "2026-10-25",
  due_time: "09:00",
  status: "todo",
  recurring: true,
  skip_state: "none",
};
describe("Bogota dated execution rules", () => {
  it("uses America/Bogota across UTC midnight", () =>
    expect(agencyDate(new Date("2026-10-26T02:00:00Z"))).toBe("2026-10-25"));
  it("does not show future work on today's schedule", () =>
    expect(scheduledFor({ ...task, scheduled_date: "2026-10-26" }, "2026-10-25")).toBe(false));
  it("never automatically marks no-time work overdue", () =>
    expect(executionOverdue({ ...task, due_time: null }, new Date("2026-11-01T00:00:00Z"))).toBe(
      false,
    ));
  it("marks a timed incomplete execution overdue only after its Bogota deadline", () => {
    expect(executionOverdue(task, new Date("2026-10-25T13:59:00Z"))).toBe(false);
    expect(executionOverdue(task, new Date("2026-10-25T14:01:00Z"))).toBe(true);
    expect(executionOverdue({ ...task, status: "done" }, new Date("2026-10-25T14:01:00Z"))).toBe(
      false,
    );
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
  it("navigates dates without device timezone drift", () =>
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01"));
});

import { sortPortalTasks as sortPortal } from "./task-executions";
describe("creator portal ordering", () => {
  it("sorts by date then time, untimed after timed on the same date", () => {
    const r = sortPortal([
      { id: "c", scheduled_date: "2026-10-26", due_time: "08:00" },
      { id: "b", scheduled_date: "2026-10-25", due_time: null },
      { id: "a", scheduled_date: "2026-10-25", due_time: "14:30:00" },
    ]);
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
import { formatTime12, ownerCreatorConsistent, recurrenceLabel } from "./task-executions";
describe("portal labels and consistency", () => {
  it("labels recurrence plainly", () => {
    expect(recurrenceLabel("daily")).toBe("Daily");
    expect(recurrenceLabel("weekdays", [3, 1])).toBe("Weekly: Mon, Wed");
  });
  it("formats 15:00 and 16:00 exactly", () => {
    expect(formatTime12("15:00:00")).toBe("3:00 PM");
    expect(formatTime12("16:00")).toBe("4:00 PM");
    expect(formatTime12("00:30")).toBe("12:30 AM");
  });
  it("flags published tasks whose owner is not the linked creator", () => {
    const users = { c1: "u1" };
    expect(ownerCreatorConsistent({ owner_id: "u2", creator_id: "c1", visible_to_creator: true }, users, new Set(["u1"]))).toBe(false);
    expect(ownerCreatorConsistent({ owner_id: "u1", creator_id: "c1", visible_to_creator: true }, users, new Set(["u1"]))).toBe(true);
  });
});

import { portalStatus as ps } from "./task-executions";
describe("portalStatus", () => {
  const base = { id: "1", task_id: "t", title: "x", description: null, owner_id: null, creator_id: null, priority: "low", recurring: false, skip_state: "none", scheduled_date: "2026-10-25", due_time: "09:00" };
  const now = new Date("2026-10-25T20:00:00Z");
  it("labels done, skipped, overdue and pending", () => {
    expect(ps({ ...base, status: "done" }, now)).toBe("Completed");
    expect(ps({ ...base, status: "skipped" }, now)).toBe("Skipped");
    expect(ps({ ...base, status: "todo" }, now)).toBe("Overdue");
    expect(ps({ ...base, status: "todo", due_time: "23:00" }, now)).toBe("Pending");
  });
});
