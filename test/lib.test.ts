import { describe, expect, it } from "vitest";
import { airdropTableHtml, AIRDROP_MEMO_PREFIX, AIRDROP_PAGE_SIZE, bucketLines, canon, dec, dedupeAirdropTransfers, esc, feePct, lpShare, paginateAirdrop, parseAirdropTransfers, planPrices, quorum, sortAirdropTransfers, summarizeAirdrop, tokenomics, tvl, usd } from "../src/lib";

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
describe("esc", () => {
  it("escapes HTML so chain/history strings cannot XSS", () => {
    expect(esc(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(esc("a&b'c")).toBe("a&amp;b&#39;c");
  });
});

describe("airdrop history", () => {
  const memo = `${AIRDROP_MEMO_PREFIX}5518f421926a | sat-info.vercel.app | leef-trader.vercel.app`;
  const act = (over: Record<string, unknown> = {}, dataOver: Record<string, unknown> = {}) => ({
    trx_id: "aa".repeat(32),
    block_num: 465527789,
    timestamp: "2026-11-09T19:11:44.500",
    global_sequence: 1,
    irreversible: true,
    act: {
      account: "sattoken1111",
      name: "transfer",
      data: { from: "smartaadmin1", to: "alice.wam", quantity: "10.0000 SAT", memo, ...dataOver },
    },
    ...over,
  });

  it("keeps only irreversible SATDROP transfers from smartaadmin1", () => {
    const rows = parseAirdropTransfers([
      act(),
      act({ irreversible: false, global_sequence: 2 }, { to: "skiprev.wam" }),
      act({ block_num: 500_000_000, global_sequence: 3 }, { to: "afterlib.wam" }),
      act({ global_sequence: 4 }, { from: "other", to: "notfrom.wam" }),
      act({ global_sequence: 5 }, { memo: "SAT/LEEF launch LP", to: "smartafees11", quantity: "10000000.0000 SAT" }),
      act({ global_sequence: 6 }, { to: "bob.wam", quantity: "5.0000 WAX" }),
      act({ act: { account: "eosio.token", name: "transfer", data: { from: "smartaadmin1", to: "x", quantity: "1 SAT", memo } }, global_sequence: 7 }),
      act({ global_sequence: 8 }, { to: "carol.wam", quantity: "3.5000 SAT" }),
    ], 465539000);
    expect(rows.map((r) => r.to)).toEqual(["alice.wam", "carol.wam"]);
    expect(summarizeAirdrop(rows)).toEqual({ total: 13.5, recipients: 2, txs: 1, transfers: 2 });
  });

  it("drops actions when lib is unknown unless marked irreversible", () => {
    expect(parseAirdropTransfers([act({ irreversible: undefined })])).toEqual([]);
    const kept = parseAirdropTransfers([act({ irreversible: true })]);
    expect(kept[0]?.to).toBe("alice.wam");
  });

  it("dedupes by global sequence and paginates", () => {
    const a = parseAirdropTransfers([act(), act({ global_sequence: 1 }, { to: "alice.wam" }), act({ global_sequence: 9, trx_id: "bb".repeat(32) }, { to: "z.wam", quantity: "1.0000 SAT" })], 5e8);
    const d = sortAirdropTransfers(dedupeAirdropTransfers(a));
    expect(d.map((r) => r.to)).toEqual(["alice.wam", "z.wam"]);
    expect(paginateAirdrop(d, 1, 1)).toMatchObject({ page: 1, pages: 2, items: [d[0]] });
    expect(paginateAirdrop(d, 9, 1).page).toBe(2);
    expect(AIRDROP_PAGE_SIZE).toBe(25);
  });

  it("sums 4-decimal SAT without float drift", () => {
    const rows = parseAirdropTransfers([
      act({ global_sequence: 1 }, { to: "a.wam", quantity: "136363.6363 SAT" }),
      act({ global_sequence: 2 }, { to: "b.wam", quantity: "11.9189 SAT" }),
      act({ global_sequence: 3 }, { to: "c.wam", quantity: "9863624.4083 SAT" }),
    ], 5e8);
    expect(summarizeAirdrop(rows).total).toBe(9_999_999.9635);
  });

  it("never emits unescaped HTML for hostile account or tx id", () => {
    const html = airdropTableHtml([{
      trxId: `"><img src=x onerror=alert(1)>`,
      to: `<script>alert(1)</script>`,
      quantity: 1,
      memo: `<b>${AIRDROP_MEMO_PREFIX}</b>`,
      timestamp: "",
      blockNum: 1,
      globalSequence: "1",
    }]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror=/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("href=\"javascript:");
  });

  it("only links well-formed WAX names and 64-char tx ids", () => {
    const good = airdropTableHtml([{
      trxId: "c7dc4b012e668c9826106a7e6f73db6858b9a283aaf16e32bd0ab775f9d8f7b2",
      to: "af3bi.wam",
      quantity: 11.9189,
      memo,
      timestamp: "",
      blockNum: 1,
      globalSequence: "1",
    }]);
    expect(good).toContain("https://waxblock.io/account/af3bi.wam");
    expect(good).toContain("https://waxblock.io/transaction/c7dc4b012e668c9826106a7e6f73db6858b9a283aaf16e32bd0ab775f9d8f7b2");
  });
});

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
