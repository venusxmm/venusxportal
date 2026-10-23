import { describe, expect, it } from "vitest";
import { validateImage } from "./media";

describe("profile and creator image validation", () => {
  it("accepts supported image types under the size limit", () => {
    expect(() => validateImage(new File([new Uint8Array(4)], "avatar.png", { type: "image/png" }))).not.toThrow();
  });

  it("rejects unsupported image types", () => {
    expect(() => validateImage(new File(["text"], "avatar.svg", { type: "image/svg+xml" }))).toThrow("JPG, PNG, WEBP, or GIF");
  });

  it("rejects images over five megabytes", () => {
    expect(() => validateImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "avatar.png", { type: "image/png" }))).toThrow("5 MB");
  });
});
