// Pure helpers (no DOM) so they can be unit-tested.
export type Row = Record<string, unknown>;

export const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Plain-decimal USD with ~3 significant digits for tiny values; never scientific notation. */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "$0";
  if (Math.abs(n) >= 0.01) return "$" + fmt(n, 2);
  const lead = Math.floor(-Math.log10(Math.abs(n))); // zeros after the decimal point (+1)
  const digits = Math.min(lead + 3, 20);
  return "$" + n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

/** Plain decimal for small non-USD numbers (e.g. WAX per LEEF). */
export function dec(n: number, sig = 3): string {
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1) return fmt(n, 2);
  const lead = Math.floor(-Math.log10(Math.abs(n)));
  return n.toFixed(Math.min(lead + sig, 20)).replace(/0+$/, "").replace(/\.$/, "");
}

export const amt = (q: string) => parseFloat(q.split(" ")[0]);
export const sym = (q: string) => q.split(" ")[1] ?? "";
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Stable JSON for comparing node answers (key order independent, drops head-block noise). */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    const o = v as Row;
    return "{" + Object.keys(o).filter((k) => k !== "next_key" || o[k] !== "").sort().map((k) => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export interface Quorum<T> { value: T; agreed: number; asked: number }

/**
 * Ask nodes until two agree. Starts with the first two in parallel, then asks the rest one by one
 * on mismatch or failure. If only one node answers at all, returns it with agreed=1.
 */
export async function quorum<T>(nodes: string[], ask: (node: string) => Promise<T>): Promise<Quorum<T>> {
  const seen = new Map<string, { v: T; n: number }>();
  let asked = 0; let lastErr: unknown = new Error("no nodes");
  const take = (res: PromiseSettledResult<T>[]) => {
    for (const r of res) {
      if (r.status === "rejected") { lastErr = r.reason; continue; }
      const k = canon(r.value); const e = seen.get(k);
      if (e) e.n++; else seen.set(k, { v: r.value, n: 1 });
    }
    for (const e of seen.values()) if (e.n >= 2) return e;
    return undefined;
  };
  const first = nodes.slice(0, 2); asked += first.length;
  let hit = take(await Promise.allSettled(first.map(ask)));
  for (const n of nodes.slice(2)) {
    if (hit) break;
    asked++; hit = take(await Promise.allSettled([ask(n)]));
  }
  if (hit) return { value: hit.v, agreed: hit.n, asked };
  const any = [...seen.values()];
  if (any.length === 1) return { value: any[0].v, agreed: 1, asked };
  if (any.length > 1) throw new Error("WAX nodes disagree");
  throw lastErr;
}

export interface ExtAsset { quantity: string; contract: string }
export interface BucketRow { balance: ExtAsset; day?: number; spent_today?: number }

/** One readable line per bucket balance, e.g. "SAT LP: 3 WAX". */
export function bucketLines(byBucket: [string, BucketRow[]][], label: (b: string) => string): string[] {
  const out: string[] = [];
  for (const [b, rows] of byBucket)
    for (const r of rows) {
      const q = r?.balance?.quantity;
      if (typeof q !== "string") continue;
      out.push(`${label(b)}: ${fmt(amt(q), 8)} ${sym(q)}`);
    }
  return out;
}

export interface Plan { id: number; price: ExtAsset; days: number; active: number | boolean }
/** WAX plans are ids 1..3, USDT plans 11..13 (id + 10). */
export function planPrices(plans: Plan[], id: number): { wax?: number; usdt?: number } {
  const w = plans.find((p) => Number(p.id) === id && p.active);
  const u = plans.find((p) => Number(p.id) === id + 10 && p.active);
  return { wax: w ? amt(w.price.quantity) : undefined, usdt: u ? amt(u.price.quantity) : undefined };
}

/** Alcor fee is in hundredths of a bip: 3000 -> 0.3 (%). */
export const feePct = (fee: number) => fee / 10000;

/** TVL: Alcor's figure if set, else LEEF side × 2 (full-range position ≈ equal value each side). */
export function tvl(tvlUSD: number, leefQty: number, leefUsd: number): { usd: number; estimate: boolean } {
  if (tvlUSD > 0) return { usd: tvlUSD, estimate: false };
  return { usd: leefUsd > 0 ? leefQty * leefUsd * 2 : 0, estimate: true };
}

export interface Tokenomics { issued: number; max: number; mintable: number; issuedPct: number; lockedPctMax: number; lockedPctIssued: number; other: number }
export function tokenomics(issued: number, max: number, inPool: number, airdrop: number): Tokenomics {
  return {
    issued, max, mintable: Math.max(0, max - issued),
    issuedPct: max ? (issued / max) * 100 : 0,
    lockedPctMax: max ? (inPool / max) * 100 : 0,
    lockedPctIssued: issued ? (inPool / issued) * 100 : 0,
    other: Math.max(0, issued - inPool - airdrop),
  };
}

/** Share of revenue going to liquidity buckets (satlp + leeflp), in %. */
export function lpShare(splits: { bucket: string; bps: number }[]): number {
  return splits.filter((s) => s.bucket === "satlp" || s.bucket === "leeflp").reduce((a, s) => a + s.bps, 0) / 100;
}

export interface PoolTok { quantity: number; symbol: string; contract: string }
export interface AlcorPool {
  id: number; fee: number; active?: boolean; tick?: number; liquidity?: string; priceA?: number; priceB?: number; tvlUSD?: number;
  volumeA24?: number; volumeB24?: number; volumeUSD24?: number; tokenA: PoolTok; tokenB: PoolTok;
}
export interface SatPoolRow {
  id: number; pair: string; fee: number; sat: number; other: number; otherSym: string; otherId: string;
  otherPerSat: number; satVol24: number; satFees24: number; tvlUsd: number; tvlEstimated: boolean; nearEmpty: boolean;
}
/** Below this, a pool is flagged near-empty: its price is meaningless and nobody should trade into it. */
export const NEAR_EMPTY_SAT = 10;
export const NEAR_EMPTY_USD = 1;
/**
 * Every Alcor pool with SAT (matched by contract, never by ticker) on either side, discovered from the live pool list,
 * biggest SAT reserve first. usdOf(id) returns a USD price for "SYMBOL@contract" (0 if unknown); satUsd prices SAT.
 */
export function satPools(pools: AlcorPool[], satContract: string, satUsd = 0, usdOf: (id: string) => number = () => 0): SatPoolRow[] {
  return pools
    .filter((p) => p.active !== false && (p.tokenA.contract === satContract || p.tokenB.contract === satContract))
    .map((p) => {
      const satIsA = p.tokenA.contract === satContract;
      const s = satIsA ? p.tokenA : p.tokenB, o = satIsA ? p.tokenB : p.tokenA;
      const sat = Number(s.quantity), other = Number(o.quantity), otherId = `${o.symbol}@${o.contract}`;
      // Alcor: priceA = B per 1 A, priceB = A per 1 B.
      const otherPerSat = Number(satIsA ? p.priceA : p.priceB) || 0;
      const satVol24 = Number(satIsA ? p.volumeA24 : p.volumeB24) || 0;
      const est = sat * satUsd + other * usdOf(otherId);
      const alcorTvl = Number(p.tvlUSD) || 0;
      const tvlUsd = alcorTvl > 0 && alcorTvl >= est * 0.5 ? alcorTvl : est;
      return {
        id: Number(p.id), pair: `SAT/${o.symbol}`, fee: p.fee, sat, other, otherSym: o.symbol, otherId, otherPerSat, satVol24,
        satFees24: satVol24 * (p.fee / 1e6), tvlUsd, tvlEstimated: tvlUsd !== alcorTvl,
        nearEmpty: sat < NEAR_EMPTY_SAT || (tvlUsd > 0 && tvlUsd < NEAR_EMPTY_USD) || !(Number(p.liquidity ?? 1) > 0),
      };
    })
    .sort((a, b) => b.sat - a.sat);
}

export interface Position { owner: string; tickLower: number; tickUpper: number; liquidity: string }
/** Share (0..1) of a pool's active liquidity held by `ours` in in-range positions. */
export function ownShare(positions: Position[], tick: number, poolLiquidity: string | number, ours: Set<string>): number {
  const L = Number(poolLiquidity); if (!(L > 0)) return 0;
  let own = 0;
  for (const x of positions) if (ours.has(x.owner) && x.tickLower <= tick && tick < x.tickUpper) own += Number(x.liquidity);
  return Math.min(1, own / L);
}
