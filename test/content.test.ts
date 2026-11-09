import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stakeBoundsHtml } from "../src/lib";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("public copy", () => {
  it("does not describe the first airdrop as upcoming", () => {
    expect(html).not.toMatch(/Once the Telegram bot is live/);
    expect(html).not.toMatch(/exact split still being decided/);
    expect(html).not.toMatch(/Taken at an unannounced time/);
    expect(html).toMatch(/first SAT airdrop was sent on 9 Nov 2026/);
    expect(html).toMatch(/SATDROP:20261108:v2:5518f421926a/);
    expect(html).toMatch(/9,999,999\.9635 SAT/);
    expect(html).toMatch(/706 wallets/);
  });

  it("says SAT is a WAX token, not Bitcoin satoshis, and that 20M of 100M is issued", () => {
    expect(html).toMatch(/not Bitcoin satoshis/);
    expect(html).toMatch(/SAT@sattoken1111/);
    expect(html).toMatch(/20,000,000 SAT is issued today/);
    expect(html).toMatch(/100,000,000/);
  });

  it("does not claim the contracts are audited", () => {
    for (const text of [html, main, readme]) {
      expect(text).not.toMatch(/have been audited/i);
      expect(text).not.toMatch(/independently audited/i);
      expect(text).not.toMatch(/are audited/i);
    }
    expect(html).toMatch(/Unaudited contracts/);
    expect(html).toMatch(/These contracts are not audited/);
  });

  it("uses only t.me/leefmaincorp as the community Telegram and sat-info.vercel.app as the canonical host", () => {
    expect(html).not.toMatch(/href=["'][^"']*t\.me\/leeftoken/i);
    expect(main).not.toMatch(/t\.me\/leeftoken/i);
    expect(html).toContain("https://t.me/leefmaincorp");
    expect(html).toContain('href="https://sat-info.vercel.app/"');
    expect(html).not.toMatch(/smart-ass-trading\.vercel\.app/);
    expect(readme).toContain("https://t.me/leefmaincorp");
  });

  it("says staking is source-only and not a place to send SAT", () => {
    expect(html).toMatch(/id="stake"/);
    expect(html).toMatch(/Not deployed and not audited/);
    expect(html).toMatch(/Do not send SAT/);
    expect(html).toContain("https://github.com/leeftoken/sat-contracts/tree/main/smartastake");
    expect(html).toContain(stakeBoundsHtml());
    expect(html).not.toMatch(/staking is live/i);
    expect(html).not.toMatch(/stake now/i);
  });
});
