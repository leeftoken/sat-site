const NODES = ["https://wax.greymass.com", "https://wax.eosusa.io", "https://wax.pink.gg"];
const ALCOR = "https://wax.alcor.exchange/api/v2";
const POOL = 12905;
const LOCK_POS = 153128;
const REFRESH_MS = 60_000;

type Row = Record<string, unknown>;

async function withTimeout(url: string, init?: RequestInit): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r;
  } finally { clearTimeout(t); }
}

async function rpc<T>(path: string, body: unknown): Promise<T> {
  let last: unknown;
  for (const n of NODES) {
    try {
      const r = await withTimeout(n + path, { method: "POST", body: JSON.stringify(body) });
      return (await r.json()) as T;
    } catch (e) { last = e; }
  }
  throw last;
}

const rows = (code: string, table: string, scope = code, extra: Row = {}) =>
  rpc<{ rows: Row[] }>("/v1/chain/get_table_rows", { code, scope, table, json: true, limit: 100, ...extra }).then((r) => r.rows);
const alcor = <T>(p: string) => withTimeout(ALCOR + p).then((r) => r.json() as Promise<T>);

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const usd = (n: number) => (n < 0.01 ? "$" + n.toPrecision(3) : "$" + fmt(n, 2));
const amt = (q: string) => parseFloat(q.split(" ")[0]);
const set = (k: string, v: string) => document.querySelectorAll<HTMLElement>(`[data-k="${k}"]`).forEach((e) => (e.textContent = v));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function bars(id: string, items: [string, number][]) {
  const el = document.getElementById(id)!;
  const max = Math.max(...items.map((i) => i[1]));
  el.innerHTML = items.map(([l, v]) => `<div class="bar"><span>${esc(l)}</span><div class="t"><div class="f" style="width:${(v / max) * 100}%"></div></div><span class="r">${fmt(v)}%</span></div>`).join("");
}

bars("alloc", [["Locked LP", 35], ["User rewards (4 years)", 25], ["Treasury (multisig)", 15], ["Team (vested)", 15], ["LEEF community airdrop", 10]]);

const ACCOUNTS: [string, string][] = [
  ["sattoken1111", "SAT token contract (eosio.token code)"],
  ["smartatrader", "leeftrader contract: plans, splits, caps, LP lock"],
  ["smartaadmin1", "Admin and SAT issuer, 2-of-3 multisig; holds airdrop SAT"],
  ["smartafees11", "Receives LP fees, 2-of-3 multisig; owns position 153128"],
  ["smartabot111", "Bot account with limited permission"],
  ["leefmaincorp", "LEEF token contract"],
  ["swap.alcor", "Alcor CLMM: pools, swaps, lockpos"],
  ["wrap.alcor", "USDT used for USDT plans"],
  ["eosio.token", "WAX system token used for WAX plans"],
];
document.getElementById("accounts-body")!.innerHTML = ACCOUNTS.map(([a, r]) => `<tr><td><a href="https://waxblock.io/account/${a}" target="_blank" rel="noopener"><code>${a}</code></a></td><td>${esc(r)}</td></tr>`).join("");

const PLAN_INFO: Record<number, [string, string, string]> = {
  1: ["Basic, 30 days", "75", "2-pool arbitrage, 50 WAX per trade, hourly report"],
  2: ["Pro, 30 days", "150", "3-pool routes, 150 WAX per trade, reserved slots"],
  3: ["Pro, 365 days", "1,500", "Pro for a year at 10 months' price"],
};

const LABEL: Record<string, string> = { satlp: "SAT LP", ops: "Ops (CPU, RAM, hosting)", leeflp: "LEEF LP / backing", rewards: "Rewards", reserve: "Reserve" };

interface Tok { quantity: number; symbol: string }
interface Pool { priceB: number; fee: number; tokenA: Tok; tokenB: Tok; tvlUSD: number; volumeUSD24: number; volumeUSDWeek: number }

async function load() {
  const status = document.getElementById("status")!;
  const errs: string[] = [];
  const run = async (name: string, f: () => Promise<void>) => { try { await f(); } catch { errs.push(name); } };
  let leefUsd = 0;

  await Promise.all([
    run("token stats", async () => {
      const s = await rpc<Record<string, { supply: string; max_supply: string }>>("/v1/chain/get_currency_stats", { code: "sattoken1111", symbol: "SAT" });
      set("supply", fmt(amt(s.SAT.supply))); set("max", `of ${fmt(amt(s.SAT.max_supply))} max`);
    }),
    run("airdrop balance", async () => {
      const b = await rpc<string[]>("/v1/chain/get_currency_balance", { code: "sattoken1111", account: "smartaadmin1", symbol: "SAT" });
      set("airdrop", fmt(b[0] ? amt(b[0]) : 0));
    }),
    run("prices", async () => {
      const [l, w] = await Promise.all([alcor<{ usd_price: number; system_price: number }>("/tokens/leef-leefmaincorp"), alcor<{ usd_price: number }>("/tokens/wax-eosio.token")]);
      leefUsd = l.usd_price;
      set("leef", `${usd(l.usd_price)} (${l.system_price.toPrecision(3)} WAX)`); set("wax", usd(w.usd_price));
    }),
    run("contract config", async () => {
      const c = (await rows("smartatrader", "config"))[0] as { paused: number; max_in_bps: number; daily_cap_bps: number };
      set("config", `${c.paused ? "Paused" : "Not paused"}; per-action cap ${c.max_in_bps / 100}%, daily cap ${c.daily_cap_bps / 100}%`);
    }),
    run("buckets", async () => {
      const b = await rows("smartatrader", "buckets");
      set("buckets", b.length ? b.map((r) => Object.values(r).join(" ")).join(" · ") : "Empty so far; no subscriptions paid yet");
    }),
    run("splits", async () => {
      const s = (await rows("smartatrader", "splits")) as { bucket: string; bps: number }[];
      bars("splits", s.sort((a, b) => b.bps - a.bps).map((r) => [LABEL[r.bucket] ?? r.bucket, r.bps / 100]));
    }),
    run("plans", async () => {
      const p = (await rows("smartatrader", "plans")) as { id: number; price: { quantity: string }; active: number }[];
      const body = document.getElementById("plans-body")!;
      const free = body.firstElementChild!.outerHTML;
      body.innerHTML = free + [1, 2, 3].filter((id) => PLAN_INFO[id]).map((id) => {
        const w = p.find((r) => r.id === id && r.active); const u = p.find((r) => r.id === id + 10 && r.active);
        const [n, stars, un] = PLAN_INFO[id];
        return `<tr><td>${n}</td><td class="r">${stars}</td><td class="r">${u ? fmt(amt(u.price.quantity), 3) : "–"}</td><td class="r">${w ? fmt(amt(w.price.quantity)) : "–"}</td><td>${un}</td></tr>`;
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

  await run("pool", async () => {
    const p = await alcor<Pool>(`/swap/pools/${POOL}`);
    set("price", fmt(p.priceB, 2)); set("fee", `${p.fee / 10000}%`);
    set("reserves", `${fmt(p.tokenA.quantity)} ${p.tokenA.symbol} + ${fmt(p.tokenB.quantity, 2)} ${p.tokenB.symbol}`);
    const est = leefUsd ? p.tokenA.quantity * leefUsd * 2 : 0;
    set("tvl", p.tvlUSD ? usd(p.tvlUSD) : est ? `About ${usd(est)} (estimate from the LEEF price; Alcor shows no USD TVL yet)` : "Not available");
    set("volume", `24h ${usd(p.volumeUSD24)} · 7d ${usd(p.volumeUSDWeek)}`);
    set("satusd", leefUsd ? `${usd(p.priceB * leefUsd)} (from LEEF price × pool price)` : "–");
  });

  const t = new Date().toLocaleTimeString();
  status.className = errs.length ? "status err" : "status";
  status.textContent = errs.length ? `Updated ${t}. Couldn't load: ${errs.join(", ")} — retrying in 60 s.` : `Live · updated ${t} · refreshes every 60 s`;
}

load();
setInterval(load, REFRESH_MS);
