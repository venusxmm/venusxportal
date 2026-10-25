import { describe, expect, it } from "vitest";
import {
  validateBlocks,
  BOARD_BLOCKS,
  blockForTime,
  currentBlock,
  timeInBlock,
  canMoveExecution,
  msToNextMinute,
} from "./task-board";
import type { Execution } from "./task-executions";
const task: Execution = {
  id: "a",
  task_id: "t",
  title: "QA",
  description: null,
  owner_id: "o",
  creator_id: null,
  priority: "medium",
  scheduled_date: "2026-10-26",
  due_time: "09:00",
  status: "todo",
  recurring: true,
  skip_state: "none",
};
describe("time block movement", () => {
  it("keeps all six blocks and recognizes Bogota's current block", () => {
    expect(BOARD_BLOCKS.map((b) => b.label)).toEqual([
      "Night",
      "Early Morning",
      "Morning",
      "Midday",
      "Afternoon",
      "Evening",
    ]);
    expect(currentBlock(new Date("2026-10-25T19:51:00Z"))?.id).toBe("midday");
    expect(blockForTime("04:00")?.id).toBe("early");
  });
  it("avoids occupied times on the execution date, not today's date", () => {
    const block = BOARD_BLOCKS.find((b) => b.id === "afternoon");
    if (!block) throw new Error("Missing block");
    expect(timeInBlock(block, task, [{ ...task, id: "b", due_time: "15:00" }])).toBe("15:05");
    expect(
      timeInBlock(block, task, [
        { ...task, id: "b", due_time: "15:00", scheduled_date: "2026-10-25" },
      ]),
    ).toBe("15:00");
    expect(task.scheduled_date).toBe("2026-10-26");
  });
  it("same-block drops preserve time; unauthorized and completed work cannot move", () => {
    const block = blockForTime(task.due_time);
    if (!block) throw new Error("Missing block");
    expect(timeInBlock(block, task, [])).toBe("09:00");
    expect(canMoveExecution(task, false)).toBe(false);
    expect(canMoveExecution({ ...task, status: "done" }, true)).toBe(false);
    expect(canMoveExecution({ ...task, archived_at: "2026-10-25" }, true)).toBe(false);
    expect(canMoveExecution({ ...task, projected: true }, true)).toBe(true);
  });
});
describe("configurable blocks", () => {
  const night = { id: "n", label: "Night", start: "00:00", end: "04:00" };
  it("03:30 lands in Night", () => expect(blockForTime("03:30", [night])?.id).toBe("n"));
  it("wraps across midnight", () => {
    const late = { id: "l", label: "Late", start: "22:00", end: "02:00" };
    expect(blockForTime("01:00", [late])?.id).toBe("l");
    expect(blockForTime("23:00", [late])?.id).toBe("l");
    expect(blockForTime("03:00", [late])).toBeUndefined();
  });
  it("rejects overlaps and accepts defaults", () => {
    expect(validateBlocks(BOARD_BLOCKS)).toBeNull();
    expect(validateBlocks([night, { id: "x", label: "X", start: "03:00", end: "05:00" }])).toMatch(/overlaps/);
  });
});
describe("Now indicator timing", () => {
  it("switches Afternoon to Evening exactly at 6:00 PM Bogota", () => {
    expect(currentBlock(new Date("2026-10-25T22:59:00Z"))?.id).toBe("afternoon");
    expect(currentBlock(new Date("2026-10-25T23:00:00Z"))?.id).toBe("evening");
  });
  it("follows edited boundaries and midnight wrap", () => {
    const edited = [{ id: "a", label: "Afternoon", start: "15:00", end: "17:30" }, { id: "e", label: "Evening", start: "17:30", end: "02:00" }];
    expect(currentBlock(new Date("2026-10-25T22:35:00Z"), edited)?.id).toBe("e");
    expect(currentBlock(new Date("2026-10-26T05:30:00Z"), edited)?.id).toBe("e");
  });
  it("ticks at the next minute boundary", () => {
    expect(msToNextMinute(new Date("2026-10-25T22:59:45Z"))).toBe(15_050);
  });
});
