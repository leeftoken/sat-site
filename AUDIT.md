# SAT site audit

Official LEEF site: https://leeftoken.io. This repo: private `leeftoken/sat-site`. Live page: https://sat-info.vercel.app.

## Status on 9 Nov 2026 (Europe/Copenhagen)

Recheck against the live site and WAX after the first SAT airdrop. Chain read from `https://wax.greymass.com` / `https://api.waxsweden.org` the same evening:

| Check | Chain |
| --- | --- |
| SAT supply | `20000000.0000 SAT` issued, max `100000000.0000`, issuer `smartaadmin1` |
| `smartaadmin1` SAT | `0.0365 SAT` remainder after the drop |
| First airdrop | 9,999,999.9635 SAT to 706 wallets in 24 txs, memo `SATDROP:20261108:v2:5518f421926a | sat-info.vercel.app | leef-trader.vercel.app`, 20:11–20:13 CET, all irreversible |

The static airdrop section no longer describes that send as upcoming. Share-card URLs point at `sat-info.vercel.app`. SAT is described as a WAX token, not Bitcoin satoshis. Contracts stay labelled unaudited. Community Telegram is `https://t.me/leefmaincorp` only.

## 9 Nov 2026 findings

| Severity | Finding | State |
| --- | --- | --- |
| High | Airdrop copy still said the drop was upcoming (`Once the Telegram bot is live…`, `exact split still being decided`) after it had been sent | Fixed in this change |
| Medium | `og:image` / `og:url` still pointed at `smart-ass-trading.vercel.app` while the live host is `sat-info.vercel.app` | Fixed |
| Medium | "SAT held for the airdrop" and tokenomics labels did not distinguish remainder vs recipients after the send | Fixed |
| Low | Planned-allocation heading still read as if the 10% community slice was unissued | Fixed; 20M/100M issued is explicit |
| Low | SAT vs Bitcoin satoshis not spelled out | Fixed |
| Low | RPC POSTs omitted `Content-Type: application/json` | Fixed |
| Info | Hyperion `/v2/history` is not on greymass (404) and aloha (403); eosphere rate-limits | Documented; history uses sweden → eosdac → eosphere |

## Still true

- The contracts are unaudited. This page only reads public tables and public history. It does not review `smartatrader` or `sattoken1111` authorization.
- Community link is `t.me/leefmaincorp`. Do not add `t.me/leeftoken`. leeftoken.io's own footer still uses that Telegram handle; this site does not.
- `https://shop.leeftoken.io` returned HTTP 404 on 24 Oct 2026. It is not linked here.
- Share-card URLs are absolute for `https://sat-info.vercel.app`.

## Out of scope

Authorization, mint, and fee logic inside `smartatrader`, `sattoken1111`, and `swap.alcor`.

## Earlier: 24 Oct 2026 (Europe/Copenhagen)

The 23 Oct review (then `NostrDanish/sat-site` at `0b4419d`) listed two high findings and several medium ones. Commit `71adae1` ("Fix all AUDIT.md findings") closed them. Chain that morning matched the live copy: issued vs not-issued are separate from the planned 35/25/15/15/10 bars, and the caps line is filled from `config`.
