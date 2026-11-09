# sat-site

Live: https://sat-info.vercel.app

Info site for SAT (Smart Ass Trading), the WAX token behind LEEF Trader — not Bitcoin satoshis. Vite + vanilla TypeScript, mobile-first, no backend.

Live data is fetched in the browser every 60 s from public WAX RPC (greymass + waxsweden queried in parallel and compared; eosphere, eosdac and aloha break ties or stand in when one fails) and the Alcor API (both send `Access-Control-Allow-Origin: *`):
`sattoken1111` stat, `smartaadmin1` SAT balance, Alcor pool 12905, `smartatrader` config/splits/plans and per-bucket balances (`buckets` is scoped by bucket name), LEEF and WAX prices, and the `swap.alcor` `locks` table (scope `swap.alcor`) for position 153128.

The airdrop distribution table is loaded once from Hyperion history (`/v2/history/get_actions`) on waxsweden, eosdac, then eosphere. It lists irreversible `sattoken1111::transfer` actions from `smartaadmin1` whose memo starts with `SATDROP:20261108:v2:`.

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
