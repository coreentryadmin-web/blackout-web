# 2026-09-19 — Largo ticker extraction: "spot" (current price) mis-pinned as SPOT (Spotify)

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Severity** | P2 |
| **Area** | `src/lib/largo/question-intent.ts` `extractTicker`/`STOPWORD_TICKERS` |
| **Status** | FIXED |

## Symptom

Live-tested (Ask Largo × Night Hawk Swings standing mandate, off-hours Thermal/Vector Largo
tool-wiring check): asked the real `/api/market/largo/query` endpoint (temp premium Clerk
session) *"What is NVDA's current GEX positioning — gamma flip level, call wall, put wall, and
current spot?"*. The model's own answer correctly read NVDA (spot 222.53, matching a direct
`GET /api/market/gex-heatmap?ticker=NVDA` cross-check exactly), and `tools_used` correctly shows
`get_positioning`/`get_gex_heatmap` fired — but the **response envelope's `ticker` field came back
`"SPOT"`**, and every downstream UI action link followed it: `"Thermal — SPOT" href="/heatmap?ticker=SPOT"`,
`"HELIX — SPOT" href="/flows?ticker=SPOT"`, `"Remember SPOT" href="#watchlist:SPOT"`, and a
follow-up chip reading *"Show SPOT GEX positioning — is it mirroring NVDA's sandwich setup?"* A
member who asked about NVDA and clicked "open in Thermal" would have landed on Spotify's chart
instead.

## Root cause

`extractTicker()` uppercases the whole question, matches every 2-5 letter run, and scans the
matches **backwards** (last mention wins) against `KNOWN_TICKERS` for a fast-path return. The
ordinary trading phrase "current spot" (meaning "current price") uppercases to the token `SPOT`,
which is *also* a real symbol (Spotify) already listed in `KNOWN_TICKERS` — so it hit the
`KNOWN_TICKERS.has(cand)` fast path and returned immediately, before ever reaching the later
`DOMAIN_UPPERCASE_WORDS` branch that already lists `"SPOT"` as non-ticker vocabulary (that guard
never fires for a `KNOWN_TICKERS` hit — it's a different code branch entirely). Because "spot"
appeared after "NVDA" in the sentence and the loop scans backward, `SPOT` beat the member's actual
`NVDA` mention.

This is the exact same bug shape the file's own `STOPWORD_TICKERS` set already documents fixing
for `NOW`/`ServiceNow` (2026-08-10) and for `NET`/`TEAM`/`SNOW`/`OPEN` (function-word collisions
with real Night Hawk tickers) — `SPOT` was simply never added to that set, likely because it reads
as "more of a real ticker" than `NOW`/`ON`/`AT`, but "spot" (current price) is extremely common
trading vocabulary and collides just as readily.

## Fix

Added `"SPOT"` to `STOPWORD_TICKERS` in `src/lib/largo/question-intent.ts`, alongside the existing
`NET`/`TEAM`/`SNOW`/`OPEN`/`ALL` entries — same mechanism: a bare lowercase "spot" in prose is
never treated as a ticker, while an explicit `$SPOT` or a genuinely shouted `SPOT` still resolves
to the real symbol (both paths already bypass `STOPWORD_TICKERS` — `hadDollar` and
`writtenUppercase()` respectively — so legitimate SPOT questions are unaffected).

## Verification

RED→GREEN: `src/lib/largo/question-intent.test.ts` — new test
`"SPOT/current-price collision does not steal the real ticker (live repro 2026-09-19)"`
reproduces the exact live question (asserts `tickerHint === "NVDA"`, was `"SPOT"` pre-fix), plus
`"what's the current spot on TSLA"` → `TSLA`, `"where's spot right now"` → `null`, and confirms
`"SPOT earnings reaction thoughts"` / `"how is $SPOT trading"` still correctly resolve to `SPOT`.

```bash
npx tsx --experimental-test-module-mocks --test src/lib/largo/question-intent.test.ts
```
36/36 pass post-fix (was 35/36, the new test failing pre-fix with `'SPOT' !== 'NVDA'`).
`npx tsc --noEmit -p .` clean.
