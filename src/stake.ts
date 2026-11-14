import { Session, SessionKit } from "@wharfkit/session";
import { WalletPluginAnchor } from "@wharfkit/wallet-plugin-anchor";
import { WalletPluginCloudWallet } from "@wharfkit/wallet-plugin-cloudwallet";
import { WebRenderer } from "@wharfkit/web-renderer";
import {
  SAT_CONTRACT,
  STAKE_ACCOUNT,
  STAKE_AIRDROP_ACCOUNT,
  STAKE_CODE_SHA256,
  STAKE_HASH_NODES,
  WAX_CHAIN_ID,
  canClaim,
  canUnstake,
  canWithdraw,
  claimAction,
  claimableUnits,
  esc,
  formatCph,
  formatDuration,
  formatSat,
  parseSatInput,
  poolSharePct,
  quorum,
  signingAllowed,
  stakeCodeLive,
  stakeCodeNote,
  stakeTransferAction,
  toInt,
  unstakeAction,
  withdrawAction,
  type Quorum,
  type Row,
} from "./lib";

export interface WaxApi {
  rpc<T>(path: string, body: unknown): Promise<T>;
  rows: (code: string, table: string, scope?: string, extra?: Row) => Promise<Row[]>;
  withTimeout: (url: string, init?: RequestInit, ms?: number) => Promise<Response>;
}

const APP_NAME = "SAT Staker";
const WAXBLOCK_TX = "https://waxblock.io/transaction/";
const HASH_TIMEOUT_MS = 6000;

interface StakeRow {
  owner: string;
  amount: bigint;
  paid_hi: unknown;
  paid_lo: unknown;
  pending_rewards: unknown;
  unstake_amount: bigint;
  unstake_ready: number;
  vote_lock_until: number;
}

interface ConfigRow {
  cooldown_secs: number;
  total_staked: bigint;
  total_cooling: bigint;
  total_votable: bigint;
  reward_pot: bigint;
  rpt_hi: unknown;
  rpt_lo: unknown;
  airdrop_account: string;
}

interface StakeState {
  hash: string;
  agreed: number;
  asked: number;
  inited: boolean;
  config: ConfigRow | null;
  stake: StakeRow | null;
  novote: boolean;
  walletSat: bigint;
  error?: string;
}

let api: WaxApi;
let kit: SessionKit | undefined;
let session: Session | undefined;
let state: StakeState = { hash: "", agreed: 0, asked: 0, inited: false, config: null, stake: null, novote: false, walletSat: 0n };
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function txIdOf(result: { response?: { [k: string]: unknown } }): string {
  const r = result.response ?? {};
  const id = r.transaction_id ?? r.transactionId;
  return typeof id === "string" ? id : "";
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isAirdropAccount(name: string, config: ConfigRow | null): boolean {
  if (!name) return false;
  if (name === STAKE_AIRDROP_ACCOUNT) return true;
  return !!config?.airdrop_account && name === config.airdrop_account;
}

function parseStake(row: Row | undefined): StakeRow | null {
  if (!row) return null;
  return {
    owner: String(row.owner ?? ""),
    amount: toInt(row.amount ?? 0),
    paid_hi: row.paid_hi ?? 0,
    paid_lo: row.paid_lo ?? 0,
    pending_rewards: row.pending_rewards ?? 0,
    unstake_amount: toInt(row.unstake_amount ?? 0),
    unstake_ready: Number(row.unstake_ready ?? 0),
    vote_lock_until: Number(row.vote_lock_until ?? 0),
  };
}

function parseConfig(row: Row | undefined): ConfigRow | null {
  if (!row) return null;
  return {
    cooldown_secs: Number(row.cooldown_secs ?? 0),
    total_staked: toInt(row.total_staked ?? 0),
    total_cooling: toInt(row.total_cooling ?? 0),
    total_votable: toInt(row.total_votable ?? 0),
    reward_pot: toInt(row.reward_pot ?? 0),
    rpt_hi: row.rpt_hi ?? 0,
    rpt_lo: row.rpt_lo ?? 0,
    airdrop_account: String(row.airdrop_account ?? ""),
  };
}

async function fetchCodeHash(): Promise<Quorum<string>> {
  const ask = async (node: string) => {
    const r = await api.withTimeout(node + "/v1/chain/get_code_hash", {
      method: "POST",
      body: JSON.stringify({ account_name: STAKE_ACCOUNT }),
    }, HASH_TIMEOUT_MS);
    const j = await r.json() as { code_hash?: string; error?: unknown };
    if (typeof j.code_hash === "string") return j.code_hash;
    throw new Error("no code_hash");
  };
  try {
    return await quorum([...STAKE_HASH_NODES], ask);
  } catch (e) {
    // Account missing or every host failed: treat as not deployed, not as a live hash.
    return { value: "", agreed: 0, asked: STAKE_HASH_NODES.length };
  }
}

function canSign(): boolean {
  return signingAllowed(state.hash, state.agreed, state.inited);
}

function actor(): string {
  return session ? String(session.actor) : "";
}

function toast(ok: boolean, text: string, txid?: string) {
  const el = $("stake-toast");
  if (!el) return;
  el.className = `stake-toast ${ok ? "ok" : "err"}`;
  el.hidden = false;
  const link = txid && /^[0-9a-f]{64}$/i.test(txid)
    ? ` <a href="${WAXBLOCK_TX}${esc(txid)}" target="_blank" rel="noopener">View on WAXBlock<span class="sr-only"> (opens in a new tab)</span></a>`
    : "";
  el.innerHTML = `<span>${esc(text)}</span>${link}`;
}

function setText(id: string, v: string) {
  const el = $(id);
  if (el) el.textContent = v;
}

function cooldownLabel(): string {
  const secs = state.config?.cooldown_secs ?? 7 * 24 * 3600;
  const days = Math.round(secs / 86400);
  return days === 1 ? "1 day" : `${days} days`;
}

function renderCountdown() {
  const cooling = state.stake?.unstake_amount ?? 0n;
  const ready = state.stake?.unstake_ready ?? 0;
  const voteLock = state.stake?.vote_lock_until ?? 0;
  const now = nowSec();

  if (cooling > 0n && ready > now) {
    setText("stake-unlock", `${formatCph(ready)} · withdrawable in ${formatDuration((ready - now) * 1000)}`);
  } else if (cooling > 0n) {
    setText("stake-unlock", ready ? `${formatCph(ready)} · ready to withdraw` : "Ready to withdraw");
  } else {
    setText("stake-unlock", "—");
  }

  const voteEl = $("stake-vote-lock");
  const voteRow = $("stake-vote-lock-row");
  if (voteLock > now) {
    if (voteRow) voteRow.hidden = false;
    if (voteEl) voteEl.textContent = `Unstake locked while this vote is open until ${formatCph(voteLock)} (${formatDuration((voteLock - now) * 1000)}).`;
  } else {
    if (voteRow) voteRow.hidden = true;
  }

  updateButtons();
}

function updateButtons() {
  const sign = canSign();
  const name = actor();
  const airdrop = isAirdropAccount(name, state.config);
  const stakeAmt = parseSatInput(($("stake-amount") as HTMLInputElement | null)?.value ?? "");
  const unstakeAmt = parseSatInput(($("unstake-amount") as HTMLInputElement | null)?.value ?? "");
  const claimable = state.config && state.stake ? claimableUnits(state.stake, state.config) : 0n;
  const staked = state.stake?.amount ?? 0n;
  const cooling = state.stake?.unstake_amount ?? 0n;

  const stakeBtn = $("stake-submit") as HTMLButtonElement | null;
  const unstakeBtn = $("unstake-submit") as HTMLButtonElement | null;
  const withdrawBtn = $("withdraw-submit") as HTMLButtonElement | null;
  const claimBtn = $("claim-submit") as HTMLButtonElement | null;

  const stakeOk = sign && !!name && stakeAmt !== null && stakeAmt > 0n && stakeAmt <= state.walletSat;
  const unstakeOk = sign && !!name && unstakeAmt !== null && canUnstake({
    amount: unstakeAmt <= staked ? unstakeAmt : 0n,
    nowSec: nowSec(),
    voteLockUntil: state.stake?.vote_lock_until ?? 0,
    isAirdrop: airdrop,
  });
  const withdrawOk = sign && !!name && canWithdraw({
    cooling,
    nowSec: nowSec(),
    ready: state.stake?.unstake_ready ?? 0,
    isAirdrop: airdrop,
  });
  const claimOk = sign && !!name && canClaim({ claimable, isAirdrop: airdrop });

  if (stakeBtn) {
    stakeBtn.disabled = !stakeOk;
    stakeBtn.title = !sign
      ? "Signing is disabled until the on-chain code hash matches the published contract."
      : !name
        ? "Connect a wallet first."
        : stakeAmt === null || stakeAmt <= 0n
          ? "Enter a positive SAT amount."
          : stakeAmt > state.walletSat
            ? "That is more SAT than this wallet holds."
            : "This sends SAT to the staking contract. It is not a CEX deposit.";
  }
  if (unstakeBtn) {
    unstakeBtn.disabled = !unstakeOk;
    unstakeBtn.title = !sign
      ? "Signing is disabled until the on-chain code hash matches the published contract."
      : airdrop
        ? "The airdrop fund cannot unstake from this page."
        : (state.stake?.vote_lock_until ?? 0) > nowSec()
          ? "Unstake is locked while your vote is open."
          : "A new unstake restarts the cooldown for the whole cooling balance.";
  }
  if (withdrawBtn) {
    withdrawBtn.disabled = !withdrawOk;
    const ready = state.stake?.unstake_ready ?? 0;
    withdrawBtn.title = withdrawOk
      ? "Withdraw SAT that has finished cooling."
      : cooling > 0n && ready > nowSec()
        ? `Withdrawable in ${formatDuration((ready - nowSec()) * 1000)}`
        : "Nothing is ready to withdraw.";
    withdrawBtn.textContent = withdrawOk || cooling === 0n
      ? "Withdraw cooling SAT"
      : `Withdrawable in ${formatDuration((Math.max(0, ready - nowSec()) * 1000))}`;
  }
  if (claimBtn) {
    claimBtn.disabled = !claimOk;
    claimBtn.title = claimOk ? "Claim settled rewards. This does not change your staked principal." : "Nothing to claim.";
  }
}

function renderBanner() {
  const banner = $("stake-banner");
  const live = $("stake-live");
  const badge = $("stake-audit-badge");
  if (badge) badge.hidden = false;
  const note = stakeCodeNote(state.hash);
  if (live) live.textContent = state.agreed ? `${note} (${state.agreed} of ${state.asked} nodes agreed.)` : note;
  if (!banner) return;
  if (stakeCodeLive(state.hash) && state.agreed >= 2) {
    banner.className = "note warn stake-banner";
    banner.innerHTML = "The on-chain code of <code>smartastake1</code> matches the published production hash. SAT is <strong>not audited yet</strong>. Nobody from LEEF will ask for keys or a fee to stake. Official group: <a href=\"https://t.me/leefmaincorp\" target=\"_blank\" rel=\"noopener\">t.me/leefmaincorp<span class=\"sr-only\"> (opens in a new tab)</span></a>.";
  } else {
    banner.className = "note warn stake-banner";
    banner.innerHTML = "<strong>Staking not live yet — contract not deployed, not audited.</strong> Do not send SAT to <code>smartastake1</code> or <code>smartadrop11</code> until the contract is deployed and the live code hash matches <code>557f65faa57a6cdfa500f3ae218fd45db6009314ba399ae55e16e7a90a9c3d79</code>. Nobody from LEEF will ask for keys or a fee to stake. Official group: <a href=\"https://t.me/leefmaincorp\" target=\"_blank\" rel=\"noopener\">t.me/leefmaincorp<span class=\"sr-only\"> (opens in a new tab)</span></a>.";
  }
}

function renderSession() {
  const name = actor();
  const connected = $("stake-connected");
  const login = $("stake-login");
  const logout = $("stake-logout") as HTMLButtonElement | null;
  if (connected) connected.textContent = name || "";
  if (login) login.hidden = !!name;
  if (logout) logout.hidden = !name;
  const accountWrap = $("stake-account-wrap");
  if (accountWrap) accountWrap.hidden = !name;
}

function renderBalances() {
  const name = actor();
  const live = canSign();
  const dash = "—";
  setText("stake-wallet", name ? `${formatSat(state.walletSat)} SAT` : dash);
  if (!live || !state.config) {
    setText("stake-staked", dash);
    setText("stake-claimable", dash);
    setText("stake-cooling", dash);
    setText("stake-unlock", dash);
    setText("stake-share", dash);
    setText("stake-total", dash);
    setText("stake-votable", dash);
    setText("stake-pot", dash);
    setText("stake-cooldown", "7 days (planned at launch)");
    const voteRow = $("stake-vote-lock-row");
    if (voteRow) voteRow.hidden = true;
    const novote = $("stake-novote-note");
    if (novote) novote.hidden = true;
    updateButtons();
    return;
  }
  const st = state.stake;
  const cfg = state.config;
  const staked = st?.amount ?? 0n;
  const claimable = st ? claimableUnits(st, cfg) : 0n;
  const cooling = st?.unstake_amount ?? 0n;
  setText("stake-staked", `${formatSat(staked)} SAT`);
  setText("stake-claimable", `${formatSat(claimable)} SAT`);
  setText("stake-cooling", `${formatSat(cooling)} SAT`);
  setText("stake-share", poolSharePct(staked, cfg.total_staked));
  setText("stake-total", `${formatSat(cfg.total_staked)} SAT`);
  setText("stake-votable", `${formatSat(cfg.total_votable)} SAT`);
  setText("stake-pot", `${formatSat(cfg.reward_pot)} SAT`);
  setText("stake-cooldown", cooldownLabel());
  const novote = $("stake-novote-note");
  if (novote) {
    const drop = isAirdropAccount(name, cfg);
    novote.hidden = !(state.novote || drop);
    novote.textContent = drop
      ? "This account is the airdrop fund. It cannot unstake, withdraw, or claim from this page."
      : "This account is marked novote. You can still stake and claim, but this stake does not vote.";
  }
  renderCountdown();
}

function renderAll() {
  renderBanner();
  renderSession();
  renderBalances();
}

async function refreshOnChain(): Promise<void> {
  const hashQ = await fetchCodeHash();
  state.hash = hashQ.value;
  state.agreed = hashQ.agreed;
  state.asked = hashQ.asked;
  state.inited = false;
  state.config = null;
  state.stake = null;
  state.novote = false;
  state.error = undefined;

  const name = actor();
  if (name) {
    try {
      const bals = await api.rpc<string[]>("/v1/chain/get_currency_balance", { code: SAT_CONTRACT, account: name, symbol: "SAT" });
      state.walletSat = bals[0] ? parseSatInput(bals[0].replace(/ SAT$/, "")) ?? 0n : 0n;
    } catch {
      state.walletSat = 0n;
      state.error = "wallet balance";
    }
  } else {
    state.walletSat = 0n;
  }

  if (stakeCodeLive(state.hash) && state.agreed >= 2) {
    try {
      const [configs, stakes, novotes] = await Promise.all([
        api.rows(STAKE_ACCOUNT, "config", STAKE_ACCOUNT),
        name ? api.rows(STAKE_ACCOUNT, "stakes", STAKE_ACCOUNT, { lower_bound: name, upper_bound: name, limit: 1 }) : Promise.resolve([]),
        name ? api.rows(STAKE_ACCOUNT, "novote", STAKE_ACCOUNT, { lower_bound: name, upper_bound: name, limit: 1 }) : Promise.resolve([]),
      ]);
      state.config = parseConfig(configs[0]);
      state.inited = !!state.config;
      state.stake = parseStake(stakes[0]);
      state.novote = novotes.length > 0;
    } catch {
      state.inited = false;
      state.config = null;
    }
  }
  renderAll();
}

export async function refreshStakeUi(): Promise<void> {
  await refreshOnChain();
}

function getKit(): SessionKit {
  if (kit) return kit;
  kit = new SessionKit({
    appName: APP_NAME,
    chains: [{ id: WAX_CHAIN_ID, url: STAKE_HASH_NODES[0] }],
    ui: new WebRenderer({ colorMode: "dark" }),
    walletPlugins: [new WalletPluginCloudWallet(), new WalletPluginAnchor()],
  });
  return kit;
}

async function connect() {
  try {
    const result = await getKit().login();
    session = result.session;
    toast(true, `Connected ${actor()}`);
    await refreshOnChain();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Wallet login was cancelled.";
    toast(false, msg);
  }
}

async function logout() {
  try {
    if (session) await getKit().logout(session);
    else await getKit().logout();
  } catch {
    // Ignore storage/logout errors; the local session is still cleared below.
  }
  session = undefined;
  renderAll();
  toast(true, "Logged out.");
}

async function restore() {
  try {
    const restored = await getKit().restore();
    if (restored) session = restored;
  } catch {
    session = undefined;
  }
}

async function transact(action: { account: string; name: string; data: Record<string, unknown> }, okText: string) {
  if (!session) throw new Error("Connect a wallet first.");
  // Re-check the hash immediately before any signature request.
  const hashQ = await fetchCodeHash();
  state.hash = hashQ.value;
  state.agreed = hashQ.agreed;
  state.asked = hashQ.asked;
  if (!canSign()) {
    renderAll();
    throw new Error("Signing is disabled: the on-chain code hash does not match the published contract.");
  }
  const result = await session.transact({ action: { account: action.account, name: action.name, authorization: [session.permissionLevel], data: action.data } });
  const id = txIdOf(result);
  toast(true, okText, id);
  await refreshOnChain();
}

function confirmUnstake(amount: bigint, cooling: bigint): Promise<boolean> {
  const modal = $("stake-confirm");
  const text = $("stake-confirm-text");
  const yes = $("stake-confirm-yes") as HTMLButtonElement | null;
  const no = $("stake-confirm-no") as HTMLButtonElement | null;
  if (!modal || !text || !yes || !no) {
    return Promise.resolve(window.confirm(`A new unstake restarts the ${cooldownLabel()} timer for the whole cooling balance, including SAT already cooling. Unstake ${formatSat(amount)} SAT?`));
  }
  const extra = cooling > 0n
    ? ` You already have ${formatSat(cooling)} SAT cooling. That clock will restart too.`
    : "";
  text.textContent = `A new unstake restarts the ${cooldownLabel()} timer for the whole cooling balance, including SAT already cooling.${extra} Unstake ${formatSat(amount)} SAT?`;
  modal.hidden = false;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      modal.hidden = true;
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      resolve(ok);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
  });
}

function switchTab(tab: "stake" | "gov") {
  const stakePanel = $("stake-panel");
  const govPanel = $("gov-panel");
  const stakeTab = $("tab-stake") as HTMLButtonElement | null;
  const govTab = $("tab-gov") as HTMLButtonElement | null;
  if (stakePanel) stakePanel.hidden = tab !== "stake";
  if (govPanel) govPanel.hidden = tab !== "gov";
  if (stakeTab) stakeTab.setAttribute("aria-selected", String(tab === "stake"));
  if (govTab) govTab.setAttribute("aria-selected", String(tab === "gov"));
}

export async function initStake(wax: WaxApi): Promise<void> {
  api = wax;
  $("stake-login")?.addEventListener("click", () => { void connect(); });
  $("stake-logout")?.addEventListener("click", () => { void logout(); });
  $("stake-amount")?.addEventListener("input", updateButtons);
  $("unstake-amount")?.addEventListener("input", updateButtons);
  $("stake-max")?.addEventListener("click", () => {
    const input = $("stake-amount") as HTMLInputElement | null;
    if (input) input.value = formatSat(state.walletSat).replace(/,/g, "");
    updateButtons();
  });
  $("unstake-max")?.addEventListener("click", () => {
    const input = $("unstake-amount") as HTMLInputElement | null;
    if (input) input.value = formatSat(state.stake?.amount ?? 0n).replace(/,/g, "");
    updateButtons();
  });
  $("stake-submit")?.addEventListener("click", async () => {
    try {
      const units = parseSatInput(($("stake-amount") as HTMLInputElement).value);
      if (units === null || units <= 0n) return;
      await transact(stakeTransferAction(actor(), units), `Staked ${formatSat(units)} SAT`);
    } catch (e) {
      toast(false, e instanceof Error ? e.message : "Stake failed.");
    }
  });
  $("unstake-submit")?.addEventListener("click", async () => {
    try {
      const units = parseSatInput(($("unstake-amount") as HTMLInputElement).value);
      if (units === null || units <= 0n) return;
      const ok = await confirmUnstake(units, state.stake?.unstake_amount ?? 0n);
      if (!ok) return;
      await transact(unstakeAction(actor(), units), `Started unstake of ${formatSat(units)} SAT`);
    } catch (e) {
      toast(false, e instanceof Error ? e.message : "Unstake failed.");
    }
  });
  $("withdraw-submit")?.addEventListener("click", async () => {
    try {
      await transact(withdrawAction(actor()), "Withdrew cooling SAT");
    } catch (e) {
      toast(false, e instanceof Error ? e.message : "Withdraw failed.");
    }
  });
  $("claim-submit")?.addEventListener("click", async () => {
    try {
      await transact(claimAction(actor()), "Claimed rewards");
    } catch (e) {
      toast(false, e instanceof Error ? e.message : "Claim failed.");
    }
  });
  document.querySelectorAll<HTMLFormElement>("#stake-app form").forEach((f) => {
    f.addEventListener("submit", (e) => e.preventDefault());
  });
  $("tab-stake")?.addEventListener("click", () => switchTab("stake"));
  $("tab-gov")?.addEventListener("click", () => switchTab("gov"));

  await restore();
  await refreshOnChain();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(renderCountdown, 1000);
}
