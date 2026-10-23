import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_BLOCKS,
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
    const morning = DEFAULT_TIME_BLOCKS[1]!;
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
