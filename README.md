# sat-site

Info site for SAT (Smart Ass Trader), the token behind LEEF Trader on WAX. Vite + vanilla TypeScript, mobile-first, no backend.

Live data is fetched in the browser every 60 s from public WAX RPC (greymass → eosusa → pink.gg fallback) and the Alcor API (both send `Access-Control-Allow-Origin: *`):
`sattoken1111` stat, `smartaadmin1` SAT balance, Alcor pool 12905, `smartatrader` config/splits/plans/buckets, LEEF and WAX prices, and the `swap.alcor` `locks` table (scope `swap.alcor`) for position 153128.

## Develop
    npm install
    npm run dev

## Deploy on Vercel
1. vercel.com → Add New → Project → import `NostrDanish/sat-site` (grant Vercel access to this private repo).
2. Framework: Vite (auto, `vercel.json` sets build `npm run build`, output `dist`). No env vars needed.
3. Deploy. Every push to `main` redeploys; PRs get preview URLs.

Content rules: no keys or secrets, never link t.me/leeftoken (community is t.me/leefmaincorp), contracts are unaudited — keep the not-financial-advice note.

## CI
A GitHub Actions build check is in `ci/github-actions-ci.yml`. Move it to `.github/workflows/ci.yml` (the bot token lacks the `workflow` scope to add it). Vercel also fails the deploy if `npm run build` fails.
