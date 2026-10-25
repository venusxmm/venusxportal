import { describe, expect, it } from "vitest";
import {
  BOARD_BLOCKS,
  blockForTime,
  currentBlock,
  timeInBlock,
  canMoveExecution,
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
