import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_BLOCKS,
  compareScheduledTasks,
  findTimeBlock,
  readTimeBlocks,
  timeForBlock,
  validateTimeBlocks,
} from "./task-schedule";

describe("daily schedule blocks", () => {
  it("rejects overlapping and invalid ranges", () => {
    expect(
      validateTimeBlocks([
        { id: "a", label: "A", start: "08:00", end: "11:00" },
        { id: "b", label: "B", start: "10:00", end: "12:00" },
      ]),
    ).toMatch(/overlap/i);
    expect(validateTimeBlocks([{ id: "a", label: "A", start: "12:00", end: "12:00" }])).toMatch(
      /valid start/i,
    );
  });

  it("maps exact times to blocks and retains an in-range time", () => {
    const morning = DEFAULT_TIME_BLOCKS[1];
    if (!morning) throw new Error("Missing morning block");
    expect(findTimeBlock(DEFAULT_TIME_BLOCKS, "09:30:00")).toEqual(morning);
    expect(timeForBlock(morning, "09:30:00")).toBe("09:30");
    expect(timeForBlock(morning, "15:00:00")).toBe(morning.start);
  });

  it("falls back to defaults for invalid saved configuration", () => {
    expect(readTimeBlocks("{broken")).toEqual(DEFAULT_TIME_BLOCKS);
    expect(
      readTimeBlocks(JSON.stringify([{ id: "bad", label: "Bad", start: "17:00", end: "08:00" }])),
    ).toEqual(DEFAULT_TIME_BLOCKS);
  });
});

describe("chronological task presentation", () => {
  const task = (id: string, due_date: string | null, due_time: string | null, status = "todo") =>
    ({ id, due_date, due_time, status });
  it("orders by date and time without modifying saved schedules", () => {
    const rows = [task("b", "2026-10-23", "11:00"), task("a", "2026-10-23", "08:00")];
    const saved = JSON.stringify(rows);
    expect([...rows].sort(compareScheduledTasks).map(t => t.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(rows)).toBe(saved);
  });
  it("puts overdue work first and untimed work after timed work on the same date", () => {
    const rows = [task("undated", null, null), task("untimed", "2026-10-23", null),
      task("timed", "2026-10-23", "09:00"), task("overdue", "2026-10-22", "23:00")];
    expect(rows.sort(compareScheduledTasks).map(t => t.id)).toEqual(["overdue", "timed", "untimed", "undated"]);
  });
  it("puts completed tasks last and breaks equal timestamp ties by id", () => {
    const rows = [task("done", "2026-10-20", "08:00", "done"), task("b", "2026-10-23", "09:00"), task("a", "2026-10-23", "09:00")];
    expect(rows.sort(compareScheduledTasks).map(t => t.id)).toEqual(["a", "b", "done"]);
  });
});
