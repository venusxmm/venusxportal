import { describe, expect, it } from "vitest";
import { resolveAppVersion } from "./version";

describe("release version", () => {
  it("accepts a v-prefixed stable release tag", () => {
    expect(resolveAppVersion("v1.0.0")).toBe("1.0.0");
  });

  it("preserves unprefixed stable versions", () => {
    expect(resolveAppVersion("1.0.0")).toBe("1.0.0");
  });

  it("falls back for invalid or missing versions", () => {
    expect(resolveAppVersion("v1.0")).toBe("1.0.0");
    expect(resolveAppVersion("v01.0.0")).toBe("1.0.0");
    expect(resolveAppVersion(undefined)).toBe("1.0.0");
  });
});
