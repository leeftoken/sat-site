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

The GitHub Actions workflow (runs both) is in `ci/github-actions-ci.yml`: the bot token lacks the `workflow` scope, so move it to `.github/workflows/ci.yml` by hand (GitHub web UI) to switch it on. Refresh pauses in hidden tabs and never overlaps. Security headers (CSP allowing only the WAX/Alcor API hosts) are in `vercel.json`. Share-card URLs assume the site is served at `https://smart-ass-trading.vercel.app`; change them in `index.html` if the domain differs.

## Audit
23 Oct 2026 review of this site against the live WAX and Alcor reads: [AUDIT.md](AUDIT.md).
