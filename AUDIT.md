# SAT site audit

Review of the `sat-site` repository against the WAX and Alcor data the page reads.

- **Date:** 23 Oct 2026, 08:00 Europe/Copenhagen (chain reads at 06:00 UTC)
- **Repo:** `NostrDanish/sat-site`, branch `main` at `0b4419d`
- **Scope:** `src/main.ts`, `index.html`, `src/style.css`, `vercel.json`, `package.json`, `ci/github-actions-ci.yml`, and the public assets. The `smartatrader`, `sattoken1111`, and `swap.alcor` contracts are not in this tree.

`npm run build` (`tsc --noEmit && vite build`) passed. The production JS bundle is 6.10 kB (2.96 kB gzip). `npm audit` reported 0 vulnerabilities across the 16 installed packages. Runtime dependencies: none.

## Verdict

The site builds, stores no secrets, and never asks a wallet to sign. Supply, caps, plans, the revenue split, the pool price, and the LP lock all match the chain. The tokenomics block does not. It describes 100,000,000 SAT as already allocated. The chain has issued 20,000,000.

## Findings

### High

**Tokenomics copy describes SAT that has not been issued.** `index.html` and the `alloc` bars in `src/main.ts` assign 35% to locked LP, 25% to user rewards, 15% to treasury, 15% to team, and 10% to the airdrop. Issued supply is 20,000,000 SAT: 10,000,000 in `smartaadmin1` and 10,000,000 in `swap.alcor`. Those two balances equal `get_currency_stats` supply, so no other account holds SAT. The remaining 80,000,000 is unissued. `smartaadmin1` is the issuer and can mint up to the cap. The sentence “No public sale and no minting beyond the cap” does not say that 80% is still mintable. The locked position is real; it holds 10% of max supply, not 35%.

**USD prices under $0.01 render in scientific notation.** `usd()` in `src/main.ts` sends every value below `0.01` through `toPrecision(3)`. At this snapshot the page prints SAT as `$1.69e-5` and LEEF as `$1.59e-7`. WAX stays readable at `$0.00469`.

### Medium

**GitHub Actions is not installed.** The workflow file is `ci/github-actions-ci.yml`. GitHub only runs `.github/workflows`. That directory is absent on the remote (contents API 404) and Actions has no runs. A Vercel build is the only check, and only once the workflow is moved. The README already records the `workflow` scope limit that left the file here.

**Two sentences are hardcoded next to live data.** “Half goes to deepening SAT and LEEF liquidity” matches this snapshot (`satlp` 30% + `leeflp` 20%). The airdrop amount of 10,000,000 SAT matches `smartaadmin1`. The splits chart is read from the chain. Those two sentences are not, so they go stale when the tables change.

**Open tabs poll without a pause or a single-flight guard.** `load()` runs on a 60-second interval. One pass is about 11 requests: currency stats, the airdrop balance, two Alcor prices, and table reads for config, buckets, splits, plans, locks, and positions, then the pool. Hidden tabs keep polling. A slow pass is not aborted, so two loads can write the DOM at once. Each node is given 8 seconds before the next fallback.

**The first RPC that answers is trusted for what the page shows.** Order is greymass, then eosusa, then pink.gg. A bad JSON body can show a false pause state, cap, or price. The page has no wallet and no signing, so the effect is a misleading page.

**The bucket line will not format nested rows.** An empty `buckets` table correctly shows “Empty so far; no subscriptions paid yet.” A non-empty row is rendered with `Object.values(row).join(" ")`. Plan prices on this contract are objects of `{ quantity, contract }`. The first paid bucket is likely to show `[object Object]`.

### Low

**No tests around the mappings that are easy to get wrong.** `package.json` has `dev`, `build`, and `preview`. Nothing covers plan ids 1–3 versus 11–13, the `fee / 10000` divisor, `priceB` meaning LEEF per SAT, or the TVL estimate that doubles the LEEF side when Alcor sends `tvlUSD` of 0.

**Share cards use a relative image.** `og:image` and `twitter:image` are `/sat-512.png`. There is no `og:url` and no absolute image URL, so previews on other sites cannot resolve the card.

**`vercel.json` sets no response headers.** It names the Vite build command, `dist`, and the framework. There is no `Content-Security-Policy`, `X-Content-Type-Options`, or `Referrer-Policy`. The document loads its own script and calls WAX and Alcor.

**The refresh is silent to assistive tech.** `#status` is not an `aria-live` region. Links with `target="_blank"` do not say they open a new tab. Heading order, table headers, the logo alt text, and contrast hold: muted text is about 6:1 on white, and accent links are about 4.6:1.

**`wax.pink.gg` timed out from the review environment** (15 seconds, earlier the same morning). Greymass and eosusa answered, including the lock query with equal bounds. The client pays the 8-second abort only when the first two nodes fail.

## Chain snapshot

Reads from `https://wax.greymass.com` and `https://wax.alcor.exchange/api/v2` at 23 Oct 2026, 08:00 Europe/Copenhagen.

| Check | Chain |
| --- | --- |
| Supply | `20000000.0000 SAT` issued, max `100000000.0000 SAT`, issuer `smartaadmin1` |
| `smartaadmin1` | `10000000.0000 SAT` |
| `swap.alcor` | `10000000.0000 SAT` (pool reserve `9999999.9762 SAT`) |
| Unissued | 80,000,000 SAT |
| Config | `paused` 0, `max_in_bps` 100, `daily_cap_bps` 500, `lock_secs` 1325419200 (42 years) |
| Splits | `satlp` 3000, `ops` 3000, `leeflp` 2000, `rewards` 1000, `reserve` 1000 bps |
| Plans | WAX ids 1–3: 213 / 427 / 4269 WAX. USDT ids 11–13: 0.975 / 1.95 / 19.5 USDT. All `active` 1 |
| Buckets | Empty |
| Pool 12905 | `priceB` 106.389 LEEF per SAT, fee 3000 (displayed 0.3%), `tvlUSD` 0, 24h volume 0 |
| Prices | LEEF `$1.59e-7` (0.0000339632 WAX). WAX `$0.00468511`. SAT about `$0.0000169` via `priceB × LEEF` |
| TVL estimate | Alcor reports 0. Each side is about $169. Doubling the LEEF side shows about $339, which matches both sides today |
| Lock | Position 153128, `unlockTime` 3118144759 = 22 Oct 2068, 17:19 Europe/Copenhagen. Owner `smartafees11` |

Account balances checked earlier the same morning, and still implied by supply identity: `smartatrader`, `smartabot111`, `leefmaincorp`, and `sattoken1111` held no SAT, and `smartafees11` held `0.0000 SAT`. `smartaadmin1` plus `swap.alcor` equals issued supply.

## What the live code got right

- Issued supply and the airdrop balance are read from `get_currency_stats` and `get_currency_balance`.
- Pause state and the 1% / 5% caps match `smartatrader` `config` and the safety copy.
- The revenue bars are sorted from the `splits` table and currently sum to 100%.
- Plan rows map WAX to ids 1–3 and USDT to ids 11–13. Stars prices stay hardcoded, and the page says so.
- `priceB` is LEEF per SAT. `fee / 10000` renders the 3000 pip fee as 0.3%.
- The lock query with equal bounds returned position 153128 on greymass and eosusa. The displayed owner is `smartafees11`.
- Chain strings used as HTML labels go through `esc()`, or they are written with `textContent`. Plan prices interpolated into HTML are numbers.
- No secrets, no `.env` committed, `.gitignore` covers `.env*`, `dist`, and `.vercel`.
- The community link is `t.me/leefmaincorp`. The README ban on `t.me/leeftoken` is kept.
- The page states that the contracts are unaudited, that this is not financial advice, that the bot is still in paper mode, and that the airdrop will not ask for keys.
- `leeftoken.io`, `leefstaker.io`, `leef-trader.vercel.app`, and `waxblock.io` returned HTTP 200.

## Repository

| Piece | State |
| --- | --- |
| History | Five commits. Latest merge `0b4419d` at 23 Oct 2026, 07:24 Europe/Copenhagen (PR #1, logo) |
| Stack | Vite 6.4.5, TypeScript 5.6, `engines.node` `>=20.19`. This build ran on Node 22 |
| Deploy | `vercel.json` runs `npm run build` and publishes `dist` |
| CI file | Present, not installed. See the medium finding above |
| Logo listings | [alcor-ui #1334](https://github.com/alcorexchange/alcor-ui/pull/1334) and [eos-airdrops #923](https://github.com/eoscafe/eos-airdrops/pull/923) were open. Extra mirrors are on postimages.org (`LOGO-LINKS.md`) |

## Out of scope

This review does not cover the authorization, mint, or fee logic inside `smartatrader`, `sattoken1111`, or `swap.alcor`. Those contracts are called out on the page as unaudited. The only on-chain check here is the tables and balances this site displays.
