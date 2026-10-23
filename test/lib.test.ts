import { describe, expect, it } from "vitest";
import { bucketLines, canon, dec, feePct, lpShare, planPrices, quorum, tokenomics, tvl, usd } from "../src/lib";

describe("usd", () => {
  it("never uses scientific notation", () => {
    expect(usd(1.69e-5)).toBe("$0.0000169");
    expect(usd(1.59e-7)).toBe("$0.000000159");
    expect(usd(0.00468511)).toBe("$0.00469");
    expect(usd(0)).toBe("$0");
    for (const n of [1e-9, 3.3e-12, 0.0099]) expect(usd(n)).not.toMatch(/e/i);
  });
  it("formats normal values with 2 decimals", () => {
    expect(usd(339.4)).toBe("$339.4");
    expect(usd(1234.567)).toBe("$1,234.57");
  });
  it("dec", () => { expect(dec(0.0000339632)).toBe("0.000034"); expect(dec(106.3887)).toBe("106.39"); });
});

describe("plans", () => {
  const P = [
    { id: 1, price: { quantity: "213.00000000 WAX", contract: "eosio.token" }, days: 30, active: 1 },
    { id: 11, price: { quantity: "0.975000 USDT", contract: "wrap.alcor" }, days: 30, active: 1 },
    { id: 2, price: { quantity: "427.00000000 WAX", contract: "eosio.token" }, days: 30, active: 0 },
  ];
  it("maps WAX ids 1-3 and USDT ids 11-13", () => {
    expect(planPrices(P, 1)).toEqual({ wax: 213, usdt: 0.975 });
    expect(planPrices(P, 2)).toEqual({ wax: undefined, usdt: undefined });
  });
});

describe("pool maths", () => {
  it("fee pips", () => expect(feePct(3000)).toBe(0.3));
  it("tvl estimate doubles LEEF side when Alcor reports 0", () => {
    expect(tvl(0, 1_063_887_425, 1.59e-7)).toEqual({ usd: 1_063_887_425 * 1.59e-7 * 2, estimate: true });
    expect(tvl(500, 1, 1)).toEqual({ usd: 500, estimate: false });
  });
  it("lp share from splits", () => {
    expect(lpShare([{ bucket: "satlp", bps: 3000 }, { bucket: "leeflp", bps: 2000 }, { bucket: "ops", bps: 3000 }])).toBe(50);
  });
});

describe("tokenomics", () => {
  it("issued vs max and locked share", () => {
    const t = tokenomics(20_000_000, 100_000_000, 10_000_000, 10_000_000);
    expect(t.mintable).toBe(80_000_000);
    expect(t.issuedPct).toBe(20);
    expect(t.lockedPctMax).toBe(10);
    expect(t.lockedPctIssued).toBe(50);
    expect(t.other).toBe(0);
  });
});

describe("buckets", () => {
  it("renders extended_asset rows, not [object Object]", () => {
    const l = bucketLines([["satlp", [{ balance: { quantity: "3.00000000 WAX", contract: "eosio.token" }, day: 1, spent_today: 0 }]]], (b) => b.toUpperCase());
    expect(l).toEqual(["SATLP: 3 WAX"]);
    expect(l.join()).not.toContain("[object");
  });
});

describe("quorum", () => {
  const nodes = ["a", "b", "c", "d"];
  it("accepts when first two agree", async () => {
    const q = await quorum(nodes, async () => ({ x: 1 }));
    expect(q).toEqual({ value: { x: 1 }, agreed: 2, asked: 2 });
  });
  it("breaks a tie with the next node", async () => {
    const ans: Record<string, number> = { a: 1, b: 2, c: 2, d: 9 };
    const q = await quorum(nodes, async (n) => ans[n]);
    expect(q.value).toBe(2); expect(q.asked).toBe(3);
  });
  it("falls back when nodes fail", async () => {
    const q = await quorum(nodes, async (n) => { if (n !== "d") throw new Error("down"); return 5; });
    expect(q).toMatchObject({ value: 5, agreed: 1 });
  });
  it("throws when all disagree", async () => {
    await expect(quorum(nodes, async (n) => n)).rejects.toThrow(/disagree/);
  });
  it("canon ignores key order", () => expect(canon({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canon({ a: [1, { c: 3, d: 2 }], b: 1 })));
});
