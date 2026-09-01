## 2026-09-01 — [FINDING, P4 audit-hygiene, Largo] `get_market_oi_change`'s 2026-08-23 finding is a fourth stale `ANALYZING` status the 2026-08-29 three-entry correction missed — CORRECTED, live-reverified

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What this corrects** | `FINDINGS.md`'s 2026-08-23 entry "`get_market_oi_change` payload exceeds 16k cap, agent loses open interest changes beyond top 50 tickers" still reads `ANALYZING` ("awaiting name count measurement to determine whether a limit or pagination is needed"). It was never resolved to a real status, and — same file, immediately below it — the sibling 2026-08-23 entry `get_market_context` (also P2, also `ANALYZING`) already got a proper correction: `docs/audit/FINDINGS.md`'s "CONFIRMED FIXED (correction to three stale `ANALYZING` statuses)" entry (2026-08-29) closed out `get_nighthawk_dossier`, `get_market_context`, and `get_analyst_ratings` with live `largo-truncation-probe.mjs` re-runs proving each COMPLETE. `get_market_oi_change` was not among the three that pass swept up, despite being the SAME class of finding, filed the SAME day, and — per this session's own reading of `run-tool.ts:655-661` and `market-data-fits.ts` — carrying an equally real, equally shipped fix. |
| **The fix already exists and is already documented elsewhere in this file** | `get_market_oi_change`'s truncation is explicitly covered by the later `FINDINGS.md` entry "Fixed-row-count truncation caps failed live THREE times in one day — switched to a runtime byte budget — FIXED" (2026-08-29): `fitMarketOiChangeForModel` was rewritten to use `fitRowsToBudget` (measures actual serialized bytes at runtime rather than betting on a fixed row-count guess), and that entry's own "Live re-verification" table reports `get_market_oi_change → 12,773 bytes (20 of 30 rows kept)`, comfortably under the 16,000-byte cap. `run-tool.ts:655-661`'s `get_market_oi_change` case still calls `fitMarketOiChangeForModel(raw).fitted` today, unchanged since that fix landed. |
| **Live re-verification this session, matching the existing correction entry's own evidence format** | Ran `largo-truncation-probe.mjs` live against production, exactly as the 2026-08-29 correction entry did for its three tools: control (`get_zerodte_rejections`) TRUNCATED as expected (instrument proven), `get_market_oi_change` → **COMPLETE**. |

```
$ node --import tsx scripts/audit/largo-truncation-probe.mjs --tools=get_market_oi_change
CONTROL get_zerodte_rejections -> TRUNCATED
  instrument PROVEN — it detected a real truncation, so COMPLETE below means clean
  ✅ get_market_oi_change       COMPLETE
=== 0 TRUNCATED · 1 clean · 0 unverified · 0 indeterminate ===
```

| Field | Detail |
|---|---|
| **Why this one was missed the first time** | The 2026-08-29 correction entry's own surface line names exactly three tools ("`get_nighthawk_dossier`, `get_market_context`, and `get_analyst_ratings`") — `get_market_oi_change` was simply not in the set that pass checked, even though it's the fourth 2026-08-23-dated `ANALYZING` entry in the same file and was fixed by a DIFFERENT, later PR (the byte-budget rewrite) than the three that pass did cover. A sweep keyed on "which tools were named in one correction entry" rather than "which `ANALYZING`-status entries in the whole file still lack a resolution" will structurally miss a case like this one. |
| **Not fixed here — nothing to fix** | Per this repo's own findings-staging convention, this file corrects the RECORD only; no code change is needed or made — the fix already shipped and is independently verified live above. |
| **Status** | CORRECTED — the 2026-08-23 `get_market_oi_change` entry's `ANALYZING` status is stale; the fix shipped via the 2026-08-29 byte-budget rewrite and is confirmed live today. |
