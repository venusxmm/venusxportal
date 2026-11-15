import { describe, expect, it } from "vitest";
import { deadlineLabel } from "./portal-deadline";
describe("deadlineLabel", () => {
  it("today", () => expect(deadlineLabel("2026-11-14", "2026-11-14").rel).toBe("Hoy"));
  it("tomorrow", () => expect(deadlineLabel("2026-11-15", "2026-11-14").rel).toBe("Mañana"));
  it("in days", () => expect(deadlineLabel("2026-11-19", "2026-11-14").rel).toBe("Vence en 5 días"));
  it("overdue", () => expect(deadlineLabel("2026-11-11", "2026-11-14").rel).toBe("Vencida hace 3 días"));
  it("overdue one", () => expect(deadlineLabel("2026-11-13", "2026-11-14").rel).toBe("Vencida hace 1 día"));
});
