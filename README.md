# sat-site

Live: https://smart-ass-trading.vercel.app

Info site for SAT (Smart Ass Trading), the token behind LEEF Trader on WAX. Vite + vanilla TypeScript, mobile-first, no backend.

Live data is fetched in the browser every 60 s from public WAX RPC (greymass + eosusa queried in parallel and compared; aloha and eosphere break ties or stand in when one fails; pink.gg dropped) and the Alcor API (both send `Access-Control-Allow-Origin: *`):
`sattoken1111` stat, `smartaadmin1` SAT balance, Alcor pool 12905, `smartatrader` config/splits/plans and per-bucket balances (`buckets` is scoped by bucket name), LEEF and WAX prices, and the `swap.alcor` `locks` table (scope `swap.alcor`) for position 153128.

## Develop
    npm install
    npm run dev

## Deploy on Vercel
1. vercel.com → Add New → Project → import `leeftoken/sat-site` (grant Vercel access to this private repo).
2. Framework: Vite (auto, `vercel.json` sets build `npm run build`, output `dist`). No env vars needed.
3. Deploy. Every push to `main` redeploys; PRs get preview URLs.

Content rules: no keys or secrets, never link t.me/leeftoken (community is t.me/leefmaincorp), contracts are unaudited — keep the not-financial-advice note.

## Test and CI
    npm test        # vitest
    npm run build

GitHub Actions runs `npm test` and `npm run build` from `.github/workflows/ci.yml`. Refresh pauses in hidden tabs and never overlaps. Security headers (CSP allowing only the WAX/Alcor API hosts) are in `vercel.json`. Share-card URLs assume the site is served at `https://smart-ass-trading.vercel.app`; change them in `index.html` if the domain differs.

Official LEEF site: https://leeftoken.io. Official GitHub: https://github.com/leeftoken (this repo is private: `leeftoken/sat-site`).

## Audit
24 Oct 2026 recheck against the live chain, after the 23 Oct findings were fixed: [AUDIT.md](AUDIT.md).
