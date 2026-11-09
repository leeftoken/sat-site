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
export interface SatPoolRow { id: number; pair: string; fee: number; sat: number; other: number; otherSym: string }
/** Every Alcor pool that has SAT (by contract, not ticker) on either side, biggest SAT reserve first. */
export function satPools(pools: { id: number; fee: number; tokenA: PoolTok; tokenB: PoolTok }[], satContract: string): SatPoolRow[] {
  return pools
    .filter((p) => p.tokenA.contract === satContract || p.tokenB.contract === satContract)
    .map((p) => {
      const satIsA = p.tokenA.contract === satContract;
      const s = satIsA ? p.tokenA : p.tokenB, o = satIsA ? p.tokenB : p.tokenA;
      return { id: Number(p.id), pair: `SAT/${o.symbol}`, fee: p.fee, sat: Number(s.quantity), other: Number(o.quantity), otherSym: o.symbol };
    })
    .sort((a, b) => b.sat - a.sat);
}

export const AIRDROP_MEMO_PREFIX = "SATDROP:20261108:v2:";
export const AIRDROP_FROM = "smartaadmin1";
export const SAT_CONTRACT = "sattoken1111";
export const AIRDROP_PAGE_SIZE = 25;
const WAX_NAME = /^[a-z1-5.]{1,13}$/;
const TX_ID = /^[0-9a-f]{64}$/i;

export const isWaxName = (s: string) => WAX_NAME.test(s);
export const isTxId = (s: string) => TX_ID.test(s);

export interface AirdropTransfer {
  trxId: string;
  to: string;
  quantity: number;
  memo: string;
  timestamp: string;
  blockNum: number;
  globalSequence: string;
}

const rec = (v: unknown): Row | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : undefined;

/**
 * Irreversible SAT transfers from smartaadmin1 whose memo starts with SATDROP:20261108:v2:.
 * If `lib` is set, keep only block_num <= last irreversible block. If not, keep only
 * actions explicitly marked irreversible (Hyperion often omits that field).
 */
export function parseAirdropTransfers(actions: unknown, lib?: number): AirdropTransfer[] {
  if (!Array.isArray(actions)) return [];
  const out: AirdropTransfer[] = [];
  for (const raw of actions) {
    const a = rec(raw);
    if (!a || a.irreversible === false) continue;
    const blockNum = Number(a.block_num);
    if (!Number.isFinite(blockNum)) continue;
    if (typeof lib === "number") { if (blockNum > lib) continue; }
    else if (a.irreversible !== true) continue;
    const act = rec(a.act);
    if (!act || act.account !== SAT_CONTRACT || act.name !== "transfer") continue;
    const data = rec(act.data);
    if (!data || data.from !== AIRDROP_FROM) continue;
    if (typeof data.to !== "string" || !data.to) continue;
    if (typeof data.memo !== "string" || !data.memo.startsWith(AIRDROP_MEMO_PREFIX)) continue;
    if (typeof data.quantity !== "string" || sym(data.quantity) !== "SAT") continue;
    const quantity = amt(data.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (typeof a.trx_id !== "string" || !a.trx_id) continue;
    const timestamp = typeof a.timestamp === "string" ? a.timestamp
      : typeof a["@timestamp"] === "string" ? (a["@timestamp"] as string) : "";
    const gs = a.global_sequence;
    const globalSequence = typeof gs === "number" || typeof gs === "string"
      ? String(gs) : `${a.trx_id}:${data.to}:${data.quantity}`;
    out.push({ trxId: a.trx_id, to: data.to, quantity, memo: data.memo, timestamp, blockNum, globalSequence });
  }
  return out;
}

export function dedupeAirdropTransfers(rows: AirdropTransfer[]): AirdropTransfer[] {
  const seen = new Set<string>();
  const out: AirdropTransfer[] = [];
  for (const r of rows) {
    if (seen.has(r.globalSequence)) continue;
    seen.add(r.globalSequence);
    out.push(r);
  }
  return out;
}

export function sortAirdropTransfers(rows: AirdropTransfer[]): AirdropTransfer[] {
  return [...rows].sort((a, b) => b.quantity - a.quantity || a.to.localeCompare(b.to) || a.blockNum - b.blockNum);
}

export interface AirdropSummary { total: number; recipients: number; txs: number; transfers: number }

export function summarizeAirdrop(rows: AirdropTransfer[]): AirdropSummary {
  const recips = new Set<string>();
  const txs = new Set<string>();
  let units = 0;
  for (const r of rows) {
    recips.add(r.to);
    txs.add(r.trxId);
    units += Math.round(r.quantity * 10_000);
  }
  return { total: units / 10_000, recipients: recips.size, txs: txs.size, transfers: rows.length };
}

export function paginateAirdrop<T>(rows: T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size) || 1);
  const p = Math.min(Math.max(1, page), pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages };
}

const NEWTAB_HTML = '<span class="sr-only"> (opens in a new tab)</span>';

/** Escaped HTML rows for the airdrop table. Account/tx links only when the id is a safe WAX/hex value. */
export function airdropTableHtml(rows: AirdropTransfer[]): string {
  if (!rows.length) return `<tr><td colspan="3">No matching irreversible transfers</td></tr>`;
  return rows.map((r) => {
    const toCell = isWaxName(r.to)
      ? `<a href="https://waxblock.io/account/${encodeURIComponent(r.to)}" target="_blank" rel="noopener">${esc(r.to)}${NEWTAB_HTML}</a>`
      : esc(r.to);
    const short = r.trxId.slice(0, 8);
    const txCell = isTxId(r.trxId)
      ? `<a href="https://waxblock.io/transaction/${encodeURIComponent(r.trxId)}" target="_blank" rel="noopener"><code>${esc(short)}…</code>${NEWTAB_HTML}</a>`
      : esc(short);
    return `<tr><td>${toCell}</td><td class="r">${esc(fmt(r.quantity, 4))}</td><td>${txCell}</td></tr>`;
  }).join("");
}
