# 0DTE Command — zero ledger commits audit (2026-07-20)

## Summary

**Night Hawk evening edition:** 3 plays (MA LONG, LOW SHORT, CRWV LONG) — **not** zero.

**0DTE Command ledger (`zerodte_setup_log`):** **0 commits** today despite 4 live scanner setups.

The scanner is **working**; hard gates are **blocking every fresh commit**. This is expected on an elevated-VIX down day when the best aligned finds are already chased (G-8 `plan_moved`).

## Live prod snapshot (~13:50 ET)

| Setup | Dir | Score | Tape aligned | Plan | Gate blocks |
|-------|-----|-------|--------------|------|-------------|
| NVDA | long | 52 | no | — | G-1 tape, G-3 score, G-4 VIX |
| TSLA | short | 64 | **yes** | MOVED (+50% vs fill) | G-3 score, G-4 VIX, G-8 chase |
| SPY | short | 56 | **yes** | MOVED (+41% vs fill) | G-3 score, G-4 VIX, G-8 chase |
| GOOGL | long | 25 | no | — | G-1 tape, G-3 score, G-4 VIX |

**Day-open VIX:** ~18.9 (elevated tier, ≥17).

**NH dedupe:** MA, LOW, CRWV excluded from 0DTE scan (`covered_elsewhere`).

**Governor:** not halted (0 stops, 0 open plans).

**Morning confirm:** 2 confirmed, 1 invalidated on NH overnight plays.

## Gate stack (why zero commits)

1. **G-4 VIX elevated (≥17)** — previously required **score ≥ 75** for all commits. On 2026-07-20 no setup reached 75 (best aligned short: TSLA 64).

2. **G-3 score floor (65)** — TSLA missed by **1 point** (64).

3. **G-8 plan_moved** — aligned shorts had premium **41–50% above** the flow’s average fill (`CHASE_PCT = 35%`). Correct “don’t chase” discipline.

4. **G-1 tape_alignment** — long setups blocked on a **down** SPY tape (7/13 evidence).

5. **Not a bug:** `zerodte-warm` cron path is healthy; `upstream_ok: true`; setups include full `gate` + `calibration` on API.

## Fix shipped (PR)

**G-4 carve-out:** Tape-**aligned** setups (G-1 would pass) use the **standard 65 floor** in elevated VIX (17–20). Counter-tape / unknown tape still require **75**.

Rationale: G-1 already blocks counter-tape losers; the extra 75 floor was producing **zero-commit** sessions for aligned flow on vol days.

**Still required to commit:** score ≥ 65, IN_RANGE plan (not MOVED), no other hard blocks, before 15:00 ET new-play cutoff.

## Ops commands

```bash
node scripts/zerodte-gate-audit-prod.mjs
# Admin: GET /api/admin/zerodte/health
# Admin: GET /api/market/zerodte/calibration
```

## UI note

`/nighthawk` 0DTE tab **“Today's plays”** = **ledger only**. Refused candidates appear under **skipped/watching** with gate sentences — not in the play count badge.
