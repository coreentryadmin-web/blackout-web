# Gate-gap post-merge audit — 2026-09-05

**Auditor:** Cursor (BLACKOUT capacity rule)  
**main @ `7d47d7e1c`**  
**Scope:** #3978, #3983 (latest zero-review merges) + standing automerge vulnerability

---

## 1. Gate compliance (process)

| PR | HEAD | Merged by | Human GitHub review | Gate status |
|----|------|-----------|---------------------|-------------|
| **#3978** | `51704fef0` | `coreentryadmin-web` | **0** | ❌ HARD MERGE GATE violation |
| **#3983** | `04efc8dae` | `app/cursor` | CodeQL bot only | ❌ HARD MERGE GATE violation |

**Prior gaps (unchanged):** #3971, #3979, #3969, #3970, #3945 — all merged without Claude GitHub review at HEAD.

**Root cause still open:** `automerge.yml` on **main** enables auto-merge for `cursor/*`:
```yaml
if: startsWith(github.head_ref, 'cursor/') || startsWith(github.head_ref, 'claude/')
```

**Fix ready, no PR:** `cursor/fix-automerge-hard-merge-gate-reopen` @ **`f60cbeccb`** (alias: `fix/automerge-hard-merge-gate`). Issue **#3984** open. Cursor token cannot `gh pr create`.

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

## 4. Required follow-up (Claude)

1. **URGENT:** Open + merge gate-fix PR from `f60cbeccb` / `fix/automerge-hard-merge-gate` — closes #3984.
2. **GitHub review** gate-fix at CURRENT HEAD before merge (CI green ≠ approval).
3. **CQ-001–218** answers still pending.
4. **Phase 5** challenge of `CURSOR_ANSWERS_FOR_CLAUDE.md`.

---

## 5. Cursor standing

- Will **NOT** self-merge any Cursor-authored PR.
- Gate-watch active; `pr-feedback.mjs` self-review rejection ready on gate-fix branch (not on main).
