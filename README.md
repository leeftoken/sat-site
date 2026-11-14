# sat-site

Live: https://sat-info.vercel.app

Info site for SAT (Smart Ass Trading), the WAX token behind LEEF Trader — not Bitcoin satoshis. Vite + vanilla TypeScript, mobile-first, no backend.

Live data is fetched in the browser every 60 s from public WAX RPC (greymass + waxsweden queried in parallel and compared; eosphere, eosdac and aloha break ties or stand in when one fails) and the Alcor API (both send `Access-Control-Allow-Origin: *`):
`sattoken1111` stat, `smartaadmin1` SAT balance, Alcor pool 12905, `smartatrader` config/splits/plans and per-bucket balances (`buckets` is scoped by bucket name), LEEF and WAX prices, and the `swap.alcor` `locks` table (scope `swap.alcor`) for position 153128.

The airdrop distribution table is loaded once from Hyperion history (`/v2/history/get_actions`) on waxsweden, eosdac, then eosphere. It lists irreversible `sattoken1111::transfer` actions from `smartaadmin1` whose memo starts with `SATDROP:20261108:v2:`.

The staking section on `#stake` is a wallet UI for the planned `smartastake` contract from `leeftoken/sat-contracts`. It is not deployed. The page shows a banner: staking is not live yet, the contract is not deployed and not audited, and nobody should send SAT to `smartastake1` or `smartadrop11`. Wallet connect uses WharfKit SessionKit (WAX Cloud Wallet and Anchor; app name `SAT Staker`). All signing buttons stay disabled unless at least two of `wax.greymass.com`, `wax.eosusa.io` and `wax.eosphere.io` agree that the on-chain code hash of `smartastake1` is the published production wasm sha256 `dff935d9797bac8a16bea24a42b4061cf066a42cd401dd9b541320fc6f42a2ad` and the contract is inited. Claimable rewards are computed from contract state (stored `pending_rewards` is stale until settle). Reward, hash-gate, quorum, cap, and split checks live in `src/lib.ts` and are unit-tested. Governance and `claimdrop` are a disabled coming-soon tab.

## Develop
    npm install
    npm run dev

## Deploy on Vercel
1. vercel.com → Add New → Project → import `leeftoken/sat-site` (grant Vercel access to this private repo).
2. Framework: Vite (auto, `vercel.json` sets build `npm run build`, output `dist`). No env vars needed.
3. Deploy. Every push to `main` redeploys; PRs get preview URLs.

Content rules: no keys or secrets, never link t.me/leeftoken (community is https://t.me/leefmaincorp), contracts are unaudited — keep the not-financial-advice note. SAT is a WAX token, not Bitcoin satoshis. Only 20,000,000 of 100,000,000 SAT is issued. Share-card URLs assume https://sat-info.vercel.app.

## Test and CI
    npm test        # vitest
    npm run build

GitHub Actions runs `npm test` and `npm run build` from `.github/workflows/ci.yml`. Refresh pauses in hidden tabs and never overlaps. Security headers (CSP allowing only the WAX/Alcor API hosts) are in `vercel.json`.

Official LEEF site: https://leeftoken.io. Official GitHub: https://github.com/leeftoken (`leeftoken/sat-site`).

## Audit
9 Nov 2026 recheck (first SAT airdrop sent; copy and share URLs): [AUDIT.md](AUDIT.md).
