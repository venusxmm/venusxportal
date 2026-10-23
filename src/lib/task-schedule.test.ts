import { describe, expect, it } from "vitest";
import {
  addTimeBlock,
  DEFAULT_TIME_BLOCKS,
  compareScheduledTasks,
  canChangeTaskStatus,
  findTimeBlock,
  readTimeBlocks,
  sortTasksBySchedule,
  sortTimeBlocks,
  timeForBlock,
  updateTimeBlock,
  validateTimeBlocks,
} from "./task-schedule";

describe("daily schedule blocks", () => {
  it("sorts tasks by date and time without mutating their saved schedule values", () => {
    const tasks = [
      { id: "late", due_date: "2026-10-23", due_time: "15:30:00" },
      { id: "untimed", due_date: "2026-10-23", due_time: null },
      { id: "early", due_date: "2026-10-23", due_time: "09:15:00" },
      { id: "later-day", due_date: "2026-10-24", due_time: "08:00:00" },
      { id: "no-date", due_date: null, due_time: "06:00:00" },
    ];

    expect(sortTasksBySchedule(tasks).map((task) => task.id)).toEqual([
      "early",
      "late",
      "untimed",
      "later-day",
      "no-date",
    ]);
    expect(tasks.map(({ id, due_date, due_time }) => [id, due_date, due_time])).toEqual([
      ["late", "2026-10-23", "15:30:00"],
      ["untimed", "2026-10-23", null],
      ["early", "2026-10-23", "09:15:00"],
      ["later-day", "2026-10-24", "08:00:00"],
      ["no-date", null, "06:00:00"],
    ]);
  });

  it("allows staff to complete internal tasks but limits creators to visible tasks", () => {
    expect(canChangeTaskStatus(true, false, false)).toBe(true);
    expect(canChangeTaskStatus(false, true, true)).toBe(true);
    expect(canChangeTaskStatus(false, true, false)).toBe(false);
    expect(canChangeTaskStatus(false, false, true)).toBe(false);
  });

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

  it("creates, edits, validates, and serializes saved time blocks", () => {
    let draft = addTimeBlock(DEFAULT_TIME_BLOCKS, "night");
    draft = updateTimeBlock(draft, "evening", { end: "22:00" });
    draft = updateTimeBlock(draft, "night", {
      label: "Night",
      start: "22:00",
      end: "24:00",
    });
    const saved = sortTimeBlocks(draft);

    expect(validateTimeBlocks(saved)).toBeNull();
    expect(readTimeBlocks(JSON.stringify(saved))).toEqual(saved);
    expect(saved.at(-1)).toEqual({
      id: "night",
      label: "Night",
      start: "22:00",
      end: "24:00",
    });
  });
});

describe("chronological task presentation", () => {
  const task = (id: string, due_date: string | null, due_time: string | null, status = "todo") => ({
    id,
    due_date,
    due_time,
    status,
  });
  it("orders by date and time without modifying saved schedules", () => {
    const rows = [task("b", "2026-10-23", "11:00"), task("a", "2026-10-23", "08:00")];
    const saved = JSON.stringify(rows);
    expect([...rows].sort(compareScheduledTasks).map((t) => t.id)).toEqual(["a", "b"]);
    expect(JSON.stringify(rows)).toBe(saved);
  });
  it("puts overdue work first and untimed work after timed work on the same date", () => {
    const rows = [
      task("undated", null, null),
      task("untimed", "2026-10-23", null),
      task("timed", "2026-10-23", "09:00"),
      task("overdue", "2026-10-22", "23:00"),
    ];
    expect(rows.sort(compareScheduledTasks).map((t) => t.id)).toEqual([
      "overdue",
      "timed",
      "untimed",
      "undated",
    ]);
  });
  it("puts completed tasks last and breaks equal timestamp ties by id", () => {
    const rows = [
      task("done", "2026-10-20", "08:00", "done"),
      task("b", "2026-10-23", "09:00"),
      task("a", "2026-10-23", "09:00"),
    ];
    expect(rows.sort(compareScheduledTasks).map((t) => t.id)).toEqual(["a", "b", "done"]);
  });
});
