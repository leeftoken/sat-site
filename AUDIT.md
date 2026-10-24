# SAT site audit

Official LEEF site: https://leeftoken.io. This repo: private `leeftoken/sat-site`. Live page: https://smart-ass-trading.vercel.app.

## Status on 24 Oct 2026 (Europe/Copenhagen)

The 23 Oct review (then `NostrDanish/sat-site` at `0b4419d`) listed two high findings and several medium ones. Commit `71adae1` ("Fix all AUDIT.md findings") closed them. This note is the recheck, not a second copy of that write-up.

Chain read from `https://wax.greymass.com` the same morning:

| Check | Chain |
| --- | --- |
| SAT supply | `20000000.0000 SAT` issued, max `100000000.0000`, issuer `smartaadmin1` |
| `smartatrader` config | `paused` 0, `max_in_bps` 100 (1%), `daily_cap_bps` 500 (5%), `lock_secs` 1325419200 |
| Admin / bot / fees | `smartaadmin1`, `smartabot111`, `smartafees11` |

Those match the copy the page is built to show: issued vs not-issued are separate from the planned 35/25/15/15/10 bars, and the caps line is filled from `config`.

## What the 23 Oct findings are now

| Finding | State |
| --- | --- |
| Tokenomics described unissued SAT as already allocated | Fixed. Live block vs "Planned allocation (not issued yet)". |
| USD under $0.01 printed in scientific notation | Fixed. `usd()` in `src/lib.ts` uses a plain decimal. |
| Actions file sat outside `.github/workflows` | Fixed. Workflow is `.github/workflows/ci.yml` (`npm ci`, `npm test`, `npm run build`). |
| Hardcoded "half goes to liquidity" | Fixed. The share is `data-k="lpshare"` from the `splits` table. |
| Hidden tabs kept polling, and loads could overlap | Fixed. `tick()` returns while `document.hidden`, and `running` is single-flight. |
| First RPC answer was trusted | Fixed. `quorum()` asks until two nodes agree. |
| Bucket rows rendered `[object Object]` | Fixed. `bucketLines()` reads `balance.quantity`. |
| No tests, relative share image, no security headers, silent refresh | Fixed. `test/lib.test.ts`, absolute `og:image` / `og:url`, CSP and related headers in `vercel.json`, `#status` is `aria-live="polite"`, new-tab links have sr-only text. |

## Still true

- The contracts are unaudited. This page only reads public tables. It does not review `smartatrader` or `sattoken1111` authorization.
- Community link is `t.me/leefmaincorp`. Do not add `t.me/leeftoken`. leeftoken.io's own footer still uses that Telegram handle; this site does not.
- `https://shop.leeftoken.io` returned HTTP 404 on 24 Oct 2026. It is not linked here.
- Share-card URLs are absolute for `https://smart-ass-trading.vercel.app`. Change them in `index.html` if the domain changes.

## Out of scope

Authorization, mint, and fee logic inside `smartatrader`, `sattoken1111`, and `swap.alcor`.
