## Three 2026-08-23 Largo truncation findings marked ANALYZING are already resolved — CONFIRMED FIXED (correction)

> **kind:** `FINDING`

| **Status** | CONFIRMED FIXED (correction to three stale `ANALYZING` statuses) — live probe re-run 2026-08-29 |
|---|---|
| **Severity** | P2/P3 (originals) — this entry only corrects the record; no code changed here |
| **Surface** | `docs/audit/FINDINGS.md`'s 2026-08-23 entries for `get_nighthawk_dossier`, `get_market_context`, and `get_analyst_ratings` |

### What this corrects

Three 2026-08-23 truncation findings still read `ANALYZING` / "awaiting field audit" in `FINDINGS.md`, but each has a real merged fix, confirmed by independently re-running `largo-truncation-probe.mjs` live against production 2026-08-29 (control `get_zerodte_rejections` PROVEN in every run):

- **`get_nighthawk_dossier`** (FINDINGS.md "payload exceeds 16k transport cap... ANALYZING"): fixed by `3e7015518` ("Fix P2 Largo truncations: trim snapshots and dossier payloads"), merged 2026-08-24 — prunes `entry_context` to fields Largo needs, dropping `flow_breakdown`/`regime_state`. Live probe today: **COMPLETE**.
- **`get_market_context`** (FINDINGS.md "payload exceeds 16k transport cap... ANALYZING", 2026-08-23): superseded by the later, more specific 2026-08-28 FINDINGS.md entry (already marked FIXED) which root-caused the `spx_desk` field specifically and by `33661c13f`/#3038 ("apply SPX structure fitting to get_market_context spx_desk"). The 2026-08-23 entry is a stale duplicate of an already-corrected finding. Live probe today: **COMPLETE**.
- **`get_analyst_ratings`** (FINDINGS.md "exceeds 16k cap when called without ticker filter... ANALYZING", 2026-08-23): the market-wide fallback the finding described (`rows.slice(0, 10)` returned when a ticker had no direct match) was removed by `d171c685c` ("Fix remaining P2/P3 audit findings (website)"), merged **2026-06-19 — two months before the finding was even filed**. The current `run-tool.ts` case is strictly ticker-scoped (`uwTicker(ticker)`) with no market-wide branch at all; whatever produced the original TRUNCATED probe result, the code path it described no longer exists. Live probe today: **COMPLETE**.

### Evidence

```
$ node --import tsx scripts/audit/largo-truncation-probe.mjs --tools=get_nighthawk_dossier
CONTROL get_zerodte_rejections -> TRUNCATED (instrument PROVEN)
  ✅ get_nighthawk_dossier      COMPLETE

$ node --import tsx scripts/audit/largo-truncation-probe.mjs --tools=get_market_context
CONTROL get_zerodte_rejections -> TRUNCATED (instrument PROVEN)
  ✅ get_market_context         COMPLETE

$ node --import tsx scripts/audit/largo-truncation-probe.mjs --tools=get_analyst_ratings
CONTROL get_zerodte_rejections -> TRUNCATED (instrument PROVEN)
  ✅ get_analyst_ratings        COMPLETE
```

All three runs live against `https://blackouttrades.com`, 2026-08-29, one temp Clerk admin session per the standard probe auth flow, cleaned up after each run.

### Fix rationale

N/A — no code change in this entry. Per the repo's own convention for correcting a stale finding (append a new dated entry rather than editing the old one in place — see the earlier 2026-08-29 corrections for the home-page sticky-CTA and Largo post-close-decline findings), this entry records that all three are resolved so the coordinator sweep stops re-flagging already-fixed P2/P3 items as open work.
