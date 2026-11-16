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

  it("keeps healthy refreshes at 30 seconds and backs off degraded providers", async () => {
    const { nextRefreshDelayMs } = await import("../src/status");
    expect(nextRefreshDelayMs(0)).toBe(30_000);
    expect(nextRefreshDelayMs(1)).toBe(60_000);
    expect(nextRefreshDelayMs(2)).toBe(120_000);
    expect(nextRefreshDelayMs(8)).toBe(120_000);
  });


it("reports a partial state before the first fully successful refresh", () => {
  expect(classifyDataQuality(null, true, false)).toBe("partial");
  expect(classifyDataQuality(null, false, false)).toBe("loading");
});

it("preserves the last-good timestamp when a refresh partially fails", async () => {
  const { recordLastGoodRefresh } = await import("../src/status");
  expect(recordLastGoodRefresh(1_000, 31_000, true)).toBe(1_000);
  expect(recordLastGoodRefresh(1_000, 31_000, false)).toBe(31_000);
  expect(recordLastGoodRefresh(0, 31_000, true)).toBe(0);
});
