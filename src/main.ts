import { amt, airdropTableHtml, AIRDROP_FROM, AIRDROP_PAGE_SIZE, bucketLines, dec, dedupeAirdropTransfers, esc, feePct, fmt, lpShare, paginateAirdrop, parseAirdropTransfers, planPrices, quorum, SAT_CONTRACT, satPools, sortAirdropTransfers, summarizeAirdrop, tokenomics, tvl, usd, type AirdropTransfer, type BucketRow, type Plan, type Row } from "./lib";

// wax.eosusa.io dropped (not answering, Nov 2026); waxsweden + eosdac added as tie-breakers.
const NODES = ["https://wax.greymass.com", "https://api.waxsweden.org", "https://wax.eosphere.io", "https://wax.eosdac.io", "https://api.wax.alohaeos.com"];
// Hyperion history (same CSP hosts). greymass has no /v2/history; aloha 403s it. Prefer sweden (limit 1000), then eosdac, then eosphere.
const HISTORY_NODES = ["https://api.waxsweden.org", "https://wax.eosdac.io", "https://wax.eosphere.io"];
const ALCOR = "https://wax.alcor.exchange/api/v2";
const POOL = 12905;
const LOCK_POS = 153128;
const AIRDROP_BUDGET = 10_000_000; // SAT issued to smartaadmin1 for the airdrop (tx cde3ce9c…)
const SAT = SAT_CONTRACT;
const REFRESH_MS = 60_000;
const TIMEOUT_MS = 6000;
const HISTORY_TIMEOUT_MS = 15_000;
const HISTORY_PAGE = 100;
const HISTORY_MAX = 2000;

let singleSource = false;

async function withTimeout(url: string, init?: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const headers = new Headers(init?.headers);
    if ((init?.method ?? "GET").toUpperCase() === "POST" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const r = await fetch(url, { ...init, headers, signal: c.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
  } finally { clearTimeout(t); }
}

async function rpc<T>(path: string, body: unknown): Promise<T> {
  const q = await quorum<T>(NODES, (n) => withTimeout(n + path, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>));
  if (q.agreed < 2) singleSource = true;
  return q.value;
}

const rows = (code: string, table: string, scope = code, extra: Row = {}) =>
  rpc<{ rows: Row[] }>("/v1/chain/get_table_rows", { code, scope, table, json: true, limit: 100, ...extra }).then((r) => r.rows);
const bal = (account: string) =>
  rpc<string[]>("/v1/chain/get_currency_balance", { code: "sattoken1111", account, symbol: "SAT" }).then((b) => (b[0] ? amt(b[0]) : 0));
const alcor = <T>(p: string) => withTimeout(ALCOR + p).then((r) => r.json() as Promise<T>);

const set = (k: string, v: string) => document.querySelectorAll<HTMLElement>(`[data-k="${k}"]`).forEach((e) => (e.textContent = v));

function bars(id: string, items: [string, number][]) {
  const el = document.getElementById(id)!;
  const max = Math.max(...items.map((i) => i[1]), 1);
  el.innerHTML = items.map(([l, v]) => `<div class="bar"><span>${esc(l)}</span><div class="t"><div class="f" data-w="${(v / max) * 100}"></div></div><span class="r">${fmt(v, 1)}%</span></div>`).join("");
  // CSP-safe: set widths via CSSOM instead of inline style attributes.
  el.querySelectorAll<HTMLElement>(".f").forEach((f) => (f.style.width = `${f.dataset.w}%`));
}

bars("alloc", [["Locked LP (planned)", 35], ["User rewards, 4 years (planned)", 25], ["Treasury, multisig (planned)", 15], ["Team, vested (planned)", 15], ["LEEF community airdrop (sent)", 10]]);

const NEWTAB = '<span class="sr-only"> (opens in a new tab)</span>';
const ACCOUNTS: [string, string][] = [
  ["sattoken1111", "SAT token contract (eosio.token code)"],
  ["smartatrader", "leeftrader contract: plans, splits, caps, LP lock"],
  ["smartaadmin1", "Admin and SAT issuer, 2-of-3 multisig; sent the first SAT airdrop (remainder held here)"],
  ["smartafees11", "Receives LP fees, 2-of-3 multisig; owns position 153128"],
  ["smartabot111", "Bot account with limited permission"],
  ["leefmaincorp", "LEEF token contract"],
  ["swap.alcor", "Alcor CLMM: pools, swaps, lockpos"],
  ["wrap.alcor", "USDT used for USDT plans"],
  ["eosio.token", "WAX system token used for WAX plans"],
];
document.getElementById("accounts-body")!.innerHTML = ACCOUNTS.map(([a, r]) => `<tr><td><a href="https://waxblock.io/account/${a}" target="_blank" rel="noopener">${`<code>${a}</code>`}${NEWTAB}</a></td><td>${esc(r)}</td></tr>`).join("");

const PLAN_INFO: Record<number, [string, string, string]> = {
  1: ["Basic, 30 days", "75", "2-pool arbitrage, 50 WAX per trade, hourly report"],
  2: ["Pro, 30 days", "150", "3-pool routes, 150 WAX per trade, reserved slots"],
  3: ["Pro, 365 days", "1,500", "Pro for a year at 10 months' price"],
};

const LABEL: Record<string, string> = { satlp: "SAT LP", ops: "Ops (CPU, RAM, hosting)", leeflp: "LEEF LP / backing", rewards: "Rewards", reserve: "Reserve" };
const label = (b: string) => LABEL[b] ?? b;

interface Tok { quantity: number; symbol: string }
interface Pool { priceB: number; fee: number; tokenA: Tok; tokenB: Tok; tvlUSD: number; volumeUSD24: number; volumeUSDWeek: number; volumeA24?: number; volumeAWeek?: number }

async function load() {
  const status = document.getElementById("status")!;
  const errs: string[] = [];
  singleSource = false;
  const run = async (name: string, f: () => Promise<void>) => { try { await f(); } catch { errs.push(name); } };
  let leefUsd = 0;
  let splitRows: { bucket: string; bps: number }[] = [];

  await Promise.all([
    run("token stats", async () => {
      const [s, admin, inAlcor, pos] = await Promise.all([
        rpc<Record<string, { supply: string; max_supply: string }>>("/v1/chain/get_currency_stats", { code: SAT, symbol: "SAT" }),
        bal("smartaadmin1"), bal("swap.alcor"),
        alcor<{ id: number; amountB: string; isLocked: boolean }[]>("/account/smartafees11/positions").catch(() => []),
      ]);
      const lp = pos.find((p) => Number(p.id) === LOCK_POS);
      const locked = lp && lp.isLocked ? amt(lp.amountB) : 0;
      const t = tokenomics(amt(s.SAT.supply), amt(s.SAT.max_supply), locked, admin);
      const otherPools = Math.max(0, inAlcor - locked);
      const sent = Math.max(0, AIRDROP_BUDGET - admin);
      set("supply", fmt(t.issued)); set("max", `of ${fmt(t.max)} max`);
      set("airdrop", fmt(admin, 4)); set("airdrop-amount", `${fmt(AIRDROP_BUDGET)} SAT budget. Sent: ${fmt(sent, 4)} SAT; still in smartaadmin1: ${fmt(admin, 4)} SAT (live).`);
      set("airdrop-sent", sent > 0 ? `${fmt(sent, 4)} SAT sent (${fmt((sent / AIRDROP_BUDGET) * 100, 2)}%)` : "First airdrop recorded as sent 9 Nov 2026");
      set("t-issued", `${fmt(t.issued)} SAT (${fmt(t.issuedPct, 1)}% of max)`);
      set("t-max", `${fmt(t.max)} SAT`);
      set("t-mintable", `${fmt(t.mintable)} SAT not issued yet. smartaadmin1 (the 2-of-3 multisig issuer) can still mint up to the cap.`);
      set("t-pool", lp ? `${fmt(locked)} SAT in locked position ${LOCK_POS} (SAT/LEEF pool ${POOL})` : `Position ${LOCK_POS} not readable right now`);
      set("t-otherpools", `${fmt(otherPools)} SAT in other Alcor positions (not locked)`);
      set("t-locked", `${fmt(t.lockedPctMax, 1)}% of max supply · ${fmt(t.lockedPctIssued, 1)}% of issued supply`);
      set("t-admin", `${fmt(admin, 4)} SAT remaining in smartaadmin1 after the first airdrop`);
      set("t-other", t.other - otherPools > 0 ? `${fmt(t.other - otherPools)} SAT (includes airdrop recipients)` : "None");
      bars("issued", [["Locked LP (position " + LOCK_POS + ")", t.lockedPctMax], ["Other Alcor pools", t.max ? (otherPools / t.max) * 100 : 0], ["Airdrop remainder (smartaadmin1)", t.max ? (admin / t.max) * 100 : 0], ["Other holders (incl. airdrop)", t.max ? (Math.max(0, t.other - otherPools) / t.max) * 100 : 0], ["Not issued (mintable)", t.max ? (t.mintable / t.max) * 100 : 0]]);
    }),
    run("prices", async () => {
      const [l, w] = await Promise.all([alcor<{ usd_price: number; system_price: number }>("/tokens/leef-leefmaincorp"), alcor<{ usd_price: number }>("/tokens/wax-eosio.token")]);
      leefUsd = l.usd_price;
      set("leef", `${usd(l.usd_price)} (${dec(l.system_price)} WAX)`); set("wax", usd(w.usd_price));
    }),
    run("contract config", async () => {
      const c = (await rows("smartatrader", "config"))[0] as { paused: number; max_in_bps: number; daily_cap_bps: number };
      set("config", `${c.paused ? "Paused" : "Not paused"}; per-action cap ${c.max_in_bps / 100}%, daily cap ${c.daily_cap_bps / 100}%`);
      set("caps", `${c.max_in_bps / 100}% of a bucket per action, ${c.daily_cap_bps / 100}% per day`);
    }),
    run("splits", async () => {
      splitRows = (await rows("smartatrader", "splits")) as { bucket: string; bps: number }[];
      bars("splits", [...splitRows].sort((a, b) => b.bps - a.bps).map((r) => [label(r.bucket), r.bps / 100]));
      set("lpshare", `${fmt(lpShare(splitRows), 1)}%`);
    }),
    run("plans", async () => {
      const p = (await rows("smartatrader", "plans")) as unknown as Plan[];
      const body = document.getElementById("plans-body")!;
      const free = body.firstElementChild!.outerHTML;
      body.innerHTML = free + [1, 2, 3].map((id) => {
        const { wax, usdt } = planPrices(p, id);
        const [n, stars, un] = PLAN_INFO[id];
        return `<tr><td>${n}</td><td class="r">${stars}</td><td class="r">${usdt !== undefined ? fmt(usdt, 3) : "–"}</td><td class="r">${wax !== undefined ? fmt(wax) : "–"}</td><td>${un}</td></tr>`;
      }).join("");
    }),
    run("lock", async () => {
      const l = (await rows("swap.alcor", "locks", "swap.alcor", { lower_bound: LOCK_POS, upper_bound: LOCK_POS })) as { pos_id: number; unlockTime: number }[];
      const p = (await rows("swap.alcor", "positions", String(POOL), { lower_bound: LOCK_POS, upper_bound: LOCK_POS })) as { owner: string }[];
      if (!l[0]) { set("lock", `Position ${LOCK_POS}: lock not found on-chain right now`); return; }
      const d = new Date(l[0].unlockTime * 1000);
      set("lock", `Position ${LOCK_POS} locked with Alcor lockpos until ${d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}${p[0] ? `; owned by ${p[0].owner}, so trading fees stay claimable` : ""}`);
    }),
  ]);

  // Buckets are scoped per bucket name, one row per token.
  await run("buckets", async () => {
    const names = splitRows.map((s) => s.bucket);
    const per = await Promise.all(names.map(async (b) => [b, (await rows("smartatrader", "buckets", b)) as unknown as BucketRow[]] as [string, BucketRow[]]));
    const lines = bucketLines(per, label);
    set("buckets", lines.length ? lines.join(" · ") : "Empty so far; no subscriptions paid yet");
  });

  await run("pool", async () => {
    const p = await alcor<Pool>(`/swap/pools/${POOL}`);
    set("price", fmt(p.priceB, 2)); set("fee", `${feePct(p.fee)}%`);
    set("reserves", `${fmt(p.tokenA.quantity)} ${p.tokenA.symbol} + ${fmt(p.tokenB.quantity, 2)} ${p.tokenB.symbol}`);
    const v = tvl(p.tvlUSD, p.tokenA.quantity, leefUsd);
    set("tvl", !v.estimate ? usd(v.usd) : v.usd ? `About ${usd(v.usd)} (estimate from the LEEF price; Alcor shows no USD TVL yet)` : "Not available");
    // Alcor has no trusted SAT USD price yet, so its USD volume undercounts; show the LEEF side too.
    set("volume", `24h ${fmt(p.volumeA24 ?? 0)} LEEF · 7d ${fmt(p.volumeAWeek ?? 0)} LEEF (Alcor USD figure: 24h ${usd(p.volumeUSD24)}, 7d ${usd(p.volumeUSDWeek)})`);
    set("satusd", leefUsd ? `${usd(p.priceB * leefUsd)} (from LEEF price × pool price)` : "–");
  });

  await run("sat pools", async () => {
    const all = await alcor<{ id: number; fee: number; tokenA: Tok & { contract: string }; tokenB: Tok & { contract: string } }[]>("/swap/pools");
    const list = satPools(all, SAT);
    document.getElementById("satpools-body")!.innerHTML = list.map((p) => `<tr><td><a href="https://wax.alcor.exchange/swap?pool=${p.id}" target="_blank" rel="noopener">${p.id}${NEWTAB}</a></td><td>${esc(p.pair)}</td><td class="r">${feePct(p.fee)}%</td><td class="r">${fmt(p.sat)}</td><td class="r">${fmt(p.other, 6)} ${esc(p.otherSym)}</td></tr>`).join("") || `<tr><td colspan="5">None found</td></tr>`;
  });

  const t = new Date().toLocaleTimeString();
  const warn = singleSource ? " Some values came from a single WAX node (others failed or disagreed)." : "";
  status.className = errs.length ? "status err" : "status";
  status.textContent = errs.length ? `Updated ${t}. Couldn't load: ${errs.join(", ")} — retrying in 60 s.${warn}` : `Live · updated ${t} · refreshes every 60 s.${warn}`;
}

async function lastIrreversible(): Promise<number> {
  let lastErr: unknown = new Error("no nodes");
  for (const n of NODES) {
    try {
      const j = await withTimeout(n + "/v1/chain/get_info", { method: "POST", body: "{}" }).then((r) => r.json() as Promise<Row>);
      const lib = Number(j.last_irreversible_block_num);
      if (Number.isFinite(lib) && lib > 0) return lib;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function historyPage(node: string, skip: number, limit: number): Promise<{ actions: unknown[]; total?: number }> {
  const u = `${node}/v2/history/get_actions?account=${encodeURIComponent(AIRDROP_FROM)}&filter=${encodeURIComponent(SAT + ":transfer")}&skip=${skip}&limit=${limit}&sort=asc`;
  const d = await withTimeout(u, undefined, HISTORY_TIMEOUT_MS).then((r) => r.json() as Promise<{ actions?: unknown[]; total?: { value?: number } }>);
  const actions = Array.isArray(d.actions) ? d.actions : [];
  const total = Number(d.total?.value);
  return { actions, total: Number.isFinite(total) ? total : undefined };
}

async function historyAll(node: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let skip = 0;
  let limit = 1000;
  try {
    const first = await historyPage(node, 0, 1000);
    all.push(...first.actions);
    if (first.total !== undefined && all.length >= first.total) return all;
    if (first.total === undefined && first.actions.length > 0 && first.actions.length < 1000) return all;
    skip = all.length;
    limit = HISTORY_PAGE;
  } catch { limit = HISTORY_PAGE; }
  for (; skip < HISTORY_MAX; skip += limit) {
    const page = await historyPage(node, skip, limit);
    all.push(...page.actions);
    if (page.total !== undefined && all.length >= page.total) break;
    if (page.actions.length < limit) break;
  }
  if (!all.length) throw new Error(`empty history from ${node}`);
  return all;
}

let airdropRows: AirdropTransfer[] = [];
let airdropPage = 1;
let airdropQuery = "";
let airdropOk = false;
let airdropRunning: Promise<void> | null = null;

function airdropVisible(): AirdropTransfer[] {
  const q = airdropQuery.trim().toLowerCase();
  if (!q) return airdropRows;
  return airdropRows.filter((r) => r.to.toLowerCase().includes(q));
}

function renderAirdropPage() {
  const summary = document.getElementById("airdrop-summary");
  const body = document.getElementById("airdrop-body");
  const pageEl = document.getElementById("airdrop-page");
  const prev = document.getElementById("airdrop-prev") as HTMLButtonElement | null;
  const next = document.getElementById("airdrop-next") as HTMLButtonElement | null;
  if (!summary || !body || !airdropOk) return;
  const s = summarizeAirdrop(airdropRows);
  const shown = airdropVisible();
  const q = airdropQuery.trim();
  summary.textContent = q
    ? `On-chain: ${fmt(s.total, 4)} SAT to ${fmt(s.recipients)} wallets in ${fmt(s.txs)} irreversible transactions (${fmt(s.transfers)} transfers, deduped). ${fmt(shown.length)} match “${q}”.`
    : `On-chain: ${fmt(s.total, 4)} SAT to ${fmt(s.recipients)} wallets in ${fmt(s.txs)} irreversible transactions (${fmt(s.transfers)} transfers, deduped).`;
  const { items, page, pages } = paginateAirdrop(shown, airdropPage, AIRDROP_PAGE_SIZE);
  airdropPage = page;
  body.innerHTML = airdropTableHtml(items);
  if (pageEl) pageEl.textContent = `Page ${page} of ${pages}`;
  if (prev) prev.disabled = page <= 1;
  if (next) next.disabled = page >= pages;
}

document.getElementById("airdrop-prev")?.addEventListener("click", () => { airdropPage--; renderAirdropPage(); });
document.getElementById("airdrop-next")?.addEventListener("click", () => { airdropPage++; renderAirdropPage(); });
document.getElementById("airdrop-find")?.addEventListener("input", (event) => {
  airdropQuery = (event.target as HTMLInputElement).value;
  airdropPage = 1;
  renderAirdropPage();
});

async function loadAirdropHistory() {
  const lib = await lastIrreversible();
  let lastErr: unknown = new Error("no history node");
  let actions: unknown[] | undefined;
  for (const node of HISTORY_NODES) {
    try { actions = await historyAll(node); break; }
    catch (e) { lastErr = e; }
  }
  if (!actions) throw lastErr;
  const rows = sortAirdropTransfers(dedupeAirdropTransfers(parseAirdropTransfers(actions, lib)));
  if (!rows.length) throw new Error("no matching irreversible SATDROP transfers");
  airdropRows = rows;
  airdropOk = true;
  airdropPage = 1;
  renderAirdropPage();
}

function maybeAirdrop() {
  if (airdropOk || document.hidden) return;
  if (!airdropRunning) {
    airdropRunning = loadAirdropHistory().catch(() => {
      const summary = document.getElementById("airdrop-summary");
      if (summary && !airdropOk) summary.textContent = "Couldn't load the live distribution list from WAX history right now. The send facts above still stand; retrying…";
    }).finally(() => { airdropRunning = null; });
  }
}

// Single-flight refresh that pauses while the tab is hidden.
let running: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
function tick() {
  clearTimeout(timer);
  if (document.hidden) return;
  if (!running) running = load().finally(() => { running = null; });
  maybeAirdrop();
  running.then(() => { clearTimeout(timer); if (!document.hidden) timer = setTimeout(tick, REFRESH_MS); });
}
document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else tick(); });
tick();
