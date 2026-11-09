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

import { satPools } from "../src/lib";
describe("satPools", () => {
  it("keeps only SAT@sattoken1111 pools, either side, biggest SAT first", () => {
    const t = (symbol: string, contract: string, quantity: number) => ({ symbol, contract, quantity });
    const r = satPools([
      { id: 1, fee: 3000, tokenA: t("LEEF", "leefmaincorp", 10), tokenB: t("SAT", "sattoken1111", 5) },
      { id: 2, fee: 10000, tokenA: t("SAT", "sattoken1111", 50), tokenB: t("USDC", "wrap.alcor", 1) },
      { id: 3, fee: 3000, tokenA: t("SAT", "fake.token", 999), tokenB: t("WAX", "eosio.token", 1) },
    ], "sattoken1111");
    expect(r.map((p) => p.id)).toEqual([2, 1]);
    expect(r[0]).toMatchObject({ pair: "SAT/USDC", sat: 50, other: 1, otherSym: "USDC" });
  });
});

import { ownShare } from "../src/lib";
describe("satPools metrics", () => {
  const t = (symbol: string, contract: string, quantity: number) => ({ symbol, contract, quantity });
  it("flags near-empty pools and prices SAT in the other token", () => {
    const r = satPools([
      { id: 13238, fee: 3000, liquidity: "5", priceA: 2.9e9, priceB: 3.4e-10, tokenA: t("WAXWBTC", "eth.token", 2e-8), tokenB: t("SAT", "sattoken1111", 0.0001) },
      { id: 13235, fee: 10000, liquidity: "9", priceA: 145.3, priceB: 0.00688, volumeB24: 54311, tokenA: t("WAX", "eosio.token", 5769), tokenB: t("SAT", "sattoken1111", 837856) },
    ], "sattoken1111", 2.6e-5, (id) => (id === "WAX@eosio.token" ? 0.0038 : 0));
    expect(r[0]).toMatchObject({ id: 13235, nearEmpty: false, otherPerSat: 0.00688, satVol24: 54311 });
    expect(r[0].satFees24).toBeCloseTo(543.11, 1);
    expect(r[0].tvlUsd).toBeCloseTo(837856 * 2.6e-5 + 5769 * 0.0038, 3);
    expect(r[1]).toMatchObject({ id: 13238, nearEmpty: true });
  });
  it("ownShare counts only our in-range liquidity", () => {
    const pos = [{ owner: "danishcrypto", tickLower: -10, tickUpper: 10, liquidity: "60" }, { owner: "danishcrypto", tickLower: 20, tickUpper: 30, liquidity: "500" }, { owner: "someone", tickLower: -10, tickUpper: 10, liquidity: "40" }];
    expect(ownShare(pos, 0, "100", new Set(["danishcrypto"]))).toBeCloseTo(0.6);
    expect(ownShare(pos, 0, "0", new Set(["danishcrypto"]))).toBe(0);
  });
});
