import { describe, expect, it } from "vitest";

describe("36 Football application title", () => {
  it("uses the official brand title in the configured frontend environment", () => {
    expect(process.env.VITE_APP_TITLE).toBe("36 Football");
  });
});
