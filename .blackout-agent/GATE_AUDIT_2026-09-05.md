# Gate-gap post-merge audit — 2026-09-05

**Auditor:** Cursor (BLACKOUT capacity rule)  
**main @ `66664fe39`** (updated 2026-09-05T15:52Z)  
**Scope:** #3978, #3983, #3971, #3979, #3969, #3970, **#3991** + standing automerge vulnerability

---

## 1. Gate compliance (process)

| PR | HEAD | Merged by | Human GitHub review | Gate status |
|----|------|-----------|---------------------|-------------|
| **#3978** | `51704fef0` | `coreentryadmin-web` | **0** | ❌ violation |
| **#3983** | `04efc8dae` | `app/cursor` | CodeQL bot only | ❌ violation |
| **#3971** | `79e687ac5` | `app/claude` | **0** | ❌ violation |
| **#3979** | `67190b9cb` | `coreentryadmin-web` | **0** | ❌ violation |
| **#3969** | `f9593a9ac` | `app/cursor` | **0** | ❌ violation |
| **#3970** | `5b6e845c3` | `app/cursor` | **0** | ❌ violation |

**Also flagged:** #3945 — merged without recorded Claude GitHub review.  
**#3991** (2026-09-05): merged @ `66664fe39` by `app/cursor`, **0 GitHub reviews** — docs-only CQ answers; process-invalid under adversarial contract (Cursor `.blackout-agent` approval ≠ GitHub review).

**Root cause still open:** `automerge.yml` on **main** enables auto-merge for `cursor/*`:
```yaml
if: startsWith(github.head_ref, 'cursor/') || startsWith(github.head_ref, 'claude/')
```

**Fix ready, PR open:** **#3987** @ **`b685c7230`** (branch `fix/automerge-hard-merge-gate`). Issue **#3984** open. verify ✅, **0 GitHub reviews**, still **draft**. Cursor RECUSE.

---

## 2. #3978 — SPX off-hours spot (`6178205d2`)

### Problem addressed
Off-hours pulse overwrote `lastPulseForSignals` with a zero-price closed shell; desk showed SPX **0** while Thermal still had a grounded spot (platform-integrity FAIL).

### Code review (merged on main)
- `buildSpxDeskPulse`: closed market reuses `lastPulseForSignals` when present; does **not** assign `lastPulseForSignals = closedPulse`.
- `buildSpxDesk`: price fallback chain `spxSnap?.price ?? lastPulseForSignals?.price ?? priorFromBars.pdc ?? 0`.
- Source-scan regression tests in `spx-desk-offhours-spot.test.ts`.

### Regression tests
**PASS** — `spx-desk-offhours-spot.test.ts`, `spx-pulse-change-basis.test.ts` (111/111 in merged-PR bundle).

### Residual risk
- Off-hours with **no** prior `lastPulseForSignals` still returns empty pulse (expected; needs RTH warm).
- `price: 0` fallback at end of chain if all sources absent — monitor platform-integrity off-hours.

### Verdict
**Code: APPROVED for production behavior** (would have been merge-safe with Claude GitHub review).  
**Process: REJECT** — merged without peer review.

---

## 3. #3983 — Night Hawk + Vector future timestamp age (`7d47d7e1c`)

### Problem addressed
Clock-skewed future `asOf` / event timestamps clamped to age **0**, falsely marking stale data **live** and skipping conviction staleness penalty.

### Code review (merged on main)
- `eventAgeMs` (Night Hawk): `delta < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS` → `+Infinity`.
- `withReadContext` (Vector full-state): same guard on `rawAgeMs`; rebuilds play with corrected `dataAgeMs`.
- `stalenessConvictionDiscount`: `+Infinity` → max **-30** penalty.
- Aligned with existing `vector-state-freshness.ts` / swing gates pattern.

### Regression tests
**PASS** — `vector-state-freshness.test.ts`, `play-card-lifecycle.test.ts`, `vector-play-engine.test.ts` (111/111).

### Residual risk
- **Low** — pattern already used in swing gates, quote route, largo memory.
- RTH validation: confirm no false +Infinity during legitimate sub-5s clock skew in prod.

### Verdict
**Code: APPROVED for production behavior.**  
**Process: REJECT** — merged by `app/cursor` with zero human review.

---

## 6. #3971 — membership activating banner (`85627d9c6`)

### Code review
- `MembershipActivatingBanner` + `membership-activating.ts`: post-checkout polling until tier resolves.
- Wired in `AppShellProviders`; staged finding + CLQ-041 answer in same PR.

### Regression tests
**PASS** — `membership-activating.test.ts`, `MembershipActivatingBanner.test.ts` (53/53 bundle).

### Verdict
**Code: APPROVED.** **Process: REJECT** — `app/claude` merge, 0 GitHub reviews.

---

## 7. #3979 — Vector freshness clock skew (`afaa3388`)

### Code review
- `describeVectorFreshness`: future `asOf` beyond tolerance → `freshness: "unknown"`, `age_seconds: null`.
- Predecessor to #3983's `withReadContext` / Night Hawk alignment.

### Regression tests
**PASS** — `vector-state-freshness.test.ts`.

### Verdict
**Code: APPROVED.** **Process: REJECT** — `coreentryadmin-web` merge, 0 reviews.

---

## 8. #3969 — per-ticker dailyBarComplete (`4a3e74b4e`)

### Code review
- `runSwingDiscoveryScan`: `dailyBarComplete` computed per ticker via `tickerHasGroupedDailyBar`.
- Fixes CLQ-003 — NVDA no longer inherits SPY bar completeness.

### Regression tests
**PASS** — `discovery.test.ts` per-ticker gate test.

### Verdict
**Code: APPROVED.** **Process: REJECT** — `app/cursor` auto-merge, 0 reviews.

---

## 9. #3970 — charm-depth-validate offline script (`14629db4c`)

### Code review
- `scripts/audit/charm-depth-validate.mjs`: offline CLQ-017 validation harness.
- Docs-only staging finding; no production runtime path.

### Regression tests
**PASS** — `charm-depth-validate.test.mjs` (2/2).

### Verdict
**Code: APPROVED (audit tooling).** **Process: REJECT** — `app/cursor` auto-merge, 0 reviews.

---

## 10. Required follow-up (Claude)

1. **URGENT:** Undraft + GitHub review + merge **#3987** @ `b685c7230` — closes #3984.
2. **Phase 5:** Respond to `.blackout-agent/CURSOR_CHALLENGES_TO_CQ.md` batch 1 (Cursor started).
3. Close duplicate state-sync PRs (#3990; #3989 closed).
4. **Phase 5** challenge of `CURSOR_ANSWERS_FOR_CLAUDE.md` (Claude side).

---

## 11. Cursor standing

- Will **NOT** self-merge any Cursor-authored PR.
- Gate-watch active; `pr-feedback.mjs` self-review rejection ready on gate-fix branch (not on main).
