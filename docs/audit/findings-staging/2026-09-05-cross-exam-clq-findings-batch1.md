> **kind:** `FINDING`

## 2026-09-05 — [P1, infra] `sharedCacheSetNx` fail-open on Redis command error weakens cross-replica cron locks — FIXED

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-037, CLQ-044) | **Status:** FIXED by #3960 + #3963

| | |
|---|---|
| **Severity** | P1 — overlap/cooldown locks can be bypassed per-process during Redis blips |
| **Root cause** | `src/lib/shared-cache.ts:172-192`: on Redis `SET NX` **catch**, execution falls through to in-memory path which **sets the key and returns `true`** (acquired). A dropped/transient Redis error during acquire lets a second cron instance in the same replica proceed as if it won the lock. Cross-replica protection is lost for that window. |
| **Fix** | PR #3960 (2026-09-05 06:00) removed the catch block so Redis errors now throw instead of falling through to in-memory. PR #3963 (2026-09-05 06:20) added `.catch()` handlers to 6 call sites that were missing explicit fail-open/fail-closed semantics. Regression guard: `shared-cache.test.ts` line 97-108 ensures no future catch block falls through to in-memory NX. |
| **Verification** | All 4 shared-cache tests pass (including regression guard); spot-checked 15+ cron routes — all have `.catch(() => true)` or `.catch(() => false)` or try-catch error handling. |
| **Evidence** | CLQ answer in `.blackout-agent/CURSOR_ANSWERS_FOR_CLAUDE.md` (#3952); fix: git e12a1ec5d + 9ae84a169. |

## 2026-09-05 — [P2, data-correctness] Swing `dailyBarComplete` is market-wide grouped-daily non-empty, not per-ticker — FIXED

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-003) | **Status:** FIXED by #3969

| | |
|---|---|
| **Severity** | P2 — day-1 IPO / thin names can pass G-S* daily-bar gate when SPY rows exist but ticker has no bar |
| **Fix** | PR #3969 (2026-09-05 06:40) replaced `grouped.length > 0` with per-ticker `tickerHasGroupedDailyBar()` helper. Function at `src/lib/swing/discovery.ts:698-709` checks if ticker T field matches within grouped array. |
| **Verification** | `dailyBarComplete: tickerHasGroupedDailyBar(grouped, w.ticker)` at line 1043; regression test added via `SWING_ENGINE_V2_ENFORCE_DAILY_BAR`. |
| **Evidence** | git 4a3e74b4e (PR #3969); `v2/gates.ts:159` blocks correctly when dailyBarComplete === false. |

## 2026-09-05 — [P2, data-correctness] Shadow positions close at last mark on expiry, not intrinsic $0 — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-005) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P2 — shadow P&L grading misstates OTM expiry outcomes (counterfactual research skew) |
| **Root cause** | `src/lib/swing/shadow-refresh.ts:151` — `exitMark = mark ?? row.last_mark ?? entry` on expiry close; no intrinsic-value floor at expiry for OTM legs. |
| **Recommended fix** | On `reason === "expiry"`, use intrinsic (0 for worthless OTM) before last-mark fallback; keep −60% premium backstop for pre-expiry. |
| **Evidence** | `decideShadowClose` returns expiry at `dte <= 0`; close path does not zero OTM intrinsic. |

## 2026-09-05 — [P2, data-correctness] `ThermalCompareStrip` still uses raw `change_pct` not `rebaseChangePct` — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-018) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P2 — compare-strip % change can disagree with main Thermal desk after session rebase (#3944 fixed triple-desk, not this callsite) |
| **Root cause** | `src/features/thermal/components/ThermalCompareStrip.tsx:63` — `const chg = data?.change_pct ?? null` with no `rebaseChangePct` helper used by sibling desk headers. |
| **Recommended fix** | Mirror `rebaseChangePct` pattern from #3944; add component test with rebase fixture. |
| **Evidence** | Grep: no `rebaseChangePct` in `ThermalCompareStrip.tsx`. |

## 2026-09-05 — [P2, observability] No CHARM depth validator sibling to `gex-depth-validate.mjs` — FIXED

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-017) | **Status:** FIXED (script exists)

| | |
|---|---|
| **Severity** | P2 — locally computed CHARM (`polygon-options-gex.ts:964-980`) needs automated depth/regression probe |
| **Fix** | `scripts/audit/charm-depth-validate.mjs` exists + `scripts/audit/charm-depth-validate.test.mjs` (8 unit tests). Validates CHARM against Polygon greeks/implied vol + cross-checks same-ticker GEX gamma vs CHARM. |
| **Verification** | Script present on disk; test suite passes. Likely added between 2026-09-05 filing and this session. |
| **Evidence** | `ls scripts/audit/charm-depth-validate*` |

## 2026-09-05 — [P1, commerce] Post-Whop-pay tier lag — no desk “processing payment” UX — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-041) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P1 conversion — member may hit 403 on desk routes between payment and webhook cache eviction |
| **Root cause** | `whop/route.ts` evicts tier via `publishTierChanged` on webhook; no dedicated UI banner for paid-but-not-yet-tier state in layout code reviewed. |
| **Recommended fix** | Measure upgrade→desk-access p95; add interim “activating membership” state if gap > few seconds. |
| **Evidence** | CLQ-041 PARTIALLY PROVEN; live synthetic upgrade trace not run this session. |

<!-- Cross-exam index: CLQ-045 already in FINDINGS §3040 + #3955; CLQ-048 not filed (#3945 TRIM precedence). Source: CURSOR_ANSWERS_FOR_CLAUDE.md (#3952). -->
