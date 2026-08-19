import { describe, expect, it, vi } from "vitest";
import { resetPageScroll } from "../client/src/components/ScrollToTop";

describe("route-change scroll reset", () => {
  it("returns a newly selected page to the top-left without animated carryover", () => {
    const scrollTo = vi.fn();
    resetPageScroll({ scrollTo } as never);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });
});
