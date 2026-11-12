import { describe, expect, it } from "vitest";
import { orderBlock } from "./task-board";
import type { Execution } from "./task-executions";
const r = (id: string, sort_order: number | null, due_time: string | null, priority: string) =>
  ({ id, title: id, sort_order, due_time, priority }) as unknown as Execution;
const rows = [r("a", 1, "15:00", "low"), r("b", 2, null, "high"), r("c", 3, "09:00", "high"), r("d", 4, null, "critical")];
describe("orderBlock", () => {
  it("manual follows saved position", () => expect(orderBlock(rows).map((x) => x.id)).toEqual(["a", "b", "c", "d"]));
  it("time: earliest first, untimed after in manual order", () =>
    expect(orderBlock(rows, "time").map((x) => x.id)).toEqual(["c", "a", "b", "d"]));
  it("priority: critical>high>low, ties keep manual order", () =>
    expect(orderBlock(rows, "priority").map((x) => x.id)).toEqual(["d", "b", "c", "a"]));
});
