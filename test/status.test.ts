import { describe, expect, it } from "vitest";
import { classifyDataQuality } from "../src/status";

describe("classifyDataQuality", () => {
  it("calls recent data live only when the refresh had complete multi-node coverage", () => {
    expect(classifyDataQuality(10_000, false, false)).toBe("live");
  });

  it("distinguishes single-node results from fully corroborated live data", () => {
    expect(classifyDataQuality(10_000, false, true)).toBe("limited");
  });

  it("marks partial refreshes even when some data was refreshed successfully", () => {
    expect(classifyDataQuality(10_000, true, false)).toBe("partial");
  });

  it("prefers a stale warning once the last successful refresh is too old", () => {
    expect(classifyDataQuality(46_000, false, false)).toBe("stale");
    expect(classifyDataQuality(46_000, true, false)).toBe("stale");
  });

  it("does not label the initial empty state as live", () => {
    expect(classifyDataQuality(null, false, false)).toBe("loading");
  });
});
