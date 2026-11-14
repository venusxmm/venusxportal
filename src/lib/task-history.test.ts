import { describe, expect, it } from "vitest";
import { groupHistory } from "./task-history";
const ev = (id: string, action: string, t: string, actor = "a") => ({ id, action, body: null, actor_id: actor, created_at: t });
describe("groupHistory", () => {
  it("orders newest first and keeps comments separate", () => {
    const g = groupHistory([ev("1", "comment", "2026-11-01T10:00:00Z"), ev("2", "complete", "2026-11-02T10:00:00Z")]);
    expect(g.map((i) => i.id)).toEqual(["2", "1"]);
    expect(g[1].kind).toBe("comment");
  });
  it("merges one edit's edited+rescheduled pair, same actor within 5s", () => {
    const g = groupHistory([ev("1", "edited", "2026-11-01T10:00:00Z"), ev("2", "rescheduled", "2026-11-01T10:00:02Z")]);
    expect(g).toHaveLength(1);
    expect(g[0].events).toHaveLength(2);
  });
  it("does not merge different actors or distant times", () => {
    expect(groupHistory([ev("1", "edited", "2026-11-01T10:00:00Z"), ev("2", "rescheduled", "2026-11-01T10:00:02Z", "b")])).toHaveLength(2);
    expect(groupHistory([ev("1", "edited", "2026-11-01T10:00:00Z"), ev("2", "rescheduled", "2026-11-01T10:01:00Z")])).toHaveLength(2);
  });
});
