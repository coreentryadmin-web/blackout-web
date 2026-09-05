> **kind:** `FINDING`

## 2026-09-05 — [P1, infra] `sharedCacheSetNx` fail-open on Redis command error weakens cross-replica cron locks — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-037, CLQ-044) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P1 — overlap/cooldown locks can be bypassed per-process during Redis blips |
| **Root cause** | `src/lib/shared-cache.ts:172-192`: on Redis `SET NX` **catch**, execution falls through to in-memory path which **sets the key and returns `true`** (acquired). A dropped/transient Redis error during acquire lets a second cron instance in the same replica proceed as if it won the lock. Cross-replica protection is lost for that window. |
| **Blast radius** | Every cron using `sharedCacheSetNx` (desk-warm cooldown, vector/swing/banger overlap guards, etc.) — dual cron overlap under Redis stress. |
| **Recommended fix** | Fail **closed** on Redis error (return `false`, skip run) to match overlap-lock safety posture documented elsewhere; or retry Redis before memory fallback. Add behavioral test: Redis throw → second acquirer must not win cluster-wide. |
| **Evidence** | CLQ answer in `.blackout-agent/CURSOR_ANSWERS_FOR_CLAUDE.md` (#3952); source at `sharedCacheSetNx`. |

## 2026-09-05 — [P2, data-correctness] Swing `dailyBarComplete` is market-wide grouped-daily non-empty, not per-ticker — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-003) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P2 — day-1 IPO / thin names can pass G-S* daily-bar gate when SPY rows exist but ticker has no bar |
| **Root cause** | `src/lib/swing/discovery.ts:1024-1025` sets `dailyBarComplete: grouped.length > 0` (comment: feed posted, not per-ticker). `#3934` wired the gate but left this coarse proxy. |
| **Recommended fix** | Per-ticker grouped-daily presence (or explicit `false` when ticker absent from grouped response). Regression: IPO candidate with empty ticker bar + non-empty market feed → gate blocks. |
| **Evidence** | `v2/gates.ts:159` blocks when `dailyBarComplete === false`; discovery never sets false for missing ticker if feed non-empty. |

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

## 2026-09-05 — [P2, observability] No CHARM depth validator sibling to `gex-depth-validate.mjs` — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-017) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P2 — locally computed CHARM (`polygon-options-gex.ts:964-980`) has no automated depth/regression probe |
| **Root cause** | GEX has `scripts/gex-depth-validate.mjs`; grep finds no `charm-depth-validate` or equivalent. |
| **Recommended fix** | Add CHARM validator script + CI hook mirroring GEX depth audit pattern. |
| **Evidence** | CLQ-017 answer; `charmPerShare()` closed-form BS without validator. |

## 2026-09-05 — [P1, commerce] Post-Whop-pay tier lag — no desk “processing payment” UX — OPEN

> **kind:** `FINDING` | **Found by:** Cursor 360° cross-exam (CLQ-041) | **Status:** OPEN

| | |
|---|---|
| **Severity** | P1 conversion — member may hit 403 on desk routes between payment and webhook cache eviction |
| **Root cause** | `whop/route.ts` evicts tier via `publishTierChanged` on webhook; no dedicated UI banner for paid-but-not-yet-tier state in layout code reviewed. |
| **Recommended fix** | Measure upgrade→desk-access p95; add interim “activating membership” state if gap > few seconds. |
| **Evidence** | CLQ-041 PARTIALLY PROVEN; live synthetic upgrade trace not run this session. |

<!-- Cross-exam index: CLQ-045 already in FINDINGS §3040 + #3955; CLQ-048 not filed (#3945 TRIM precedence). Source: CURSOR_ANSWERS_FOR_CLAUDE.md (#3952). -->
