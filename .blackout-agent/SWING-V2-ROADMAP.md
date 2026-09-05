# SWING ENGINE V2 — Roadmap & Autonomous Execution Plan

**Owner:** cursor (implementation) + claude (adversarial review)  
**Design:** `docs/audit/SWING-ENGINE-V2-DESIGN.md`  
**Branch:** `cursor/swing-engine-v2-p1` (P1 active)  
**Updated:** 2026-09-05

---

## Mission

Rebuild the swing hunt to **0DTE-grade quality**: whole-market recall, multi-source intelligence (HELIX, Thermal, Vector, Meridian, walls, dark pool, Cortex), and honest near-miss visibility — for **4–15 DTE** tactical swings.

---

## Phase tracker

| Phase | Scope | Branch/PR | Status | Claude review |
|-------|--------|-----------|--------|---------------|
| **P0** | Command Deck parity (live deck, thesis health, cockpit) | `cursor/swing-command-p0` #3787 | **MERGED** `aea0a0751` | Done |
| **P1** | Dynamic tier1 cap + rejection ledger + data-fusion types | `cursor/swing-engine-v2-p1` #3808 | **VERIFYING** @ `07c87dca1` | After CI green |
| **P2** | POSITIONING + CATALYST origins + confluence gate (LIVE) | `cursor/swing-engine-v2-p1` #3808 | **IN PR** | Required |
| **P3** | Cortex + G-S6 enforce LIVE | `cursor/swing-engine-v2-p1` #3808 | **IN PR** @ `10872aa23` | Required |
| **P4** | 15m tactical manage + unified engine + UI signal stack | TBD | Pending P3 | Required |
| **P5** | Calibration graduation + sim regression | Ongoing | Pending P4 | Periodic |

---

## P1+P2 checklist (current sprint)

- [x] `src/lib/swing/v2/config.ts` — feature flags + env knobs
- [x] `src/lib/swing/v2/tier1-cap.ts` — dynamic 80–200 cap
- [x] `src/lib/swing/v2/rejections.ts` + `swing_scan_rejections` table
- [x] `src/lib/swing/v2/data-fusion.ts` — type contract
- [x] Wire `discovery.ts` + `swing-discovery` cron (cap rejections + POSITIONING origin)
- [x] `confluence.ts` + G-S6 enforce LIVE at commit
- [x] `positioning-screen.ts` + cron wiring via Vector leaders
- [x] `catalyst.ts` + `catalyst-screen.ts` + cron wiring via Benzinga bundle
- [x] Unit tests green (32 tests: tier1-cap, data-fusion, confluence, positioning, discovery)
- [x] PR #3808 open, LIVE-by-default @ `10872aa23`
- [ ] CI verify green @ `10872aa23`
- [ ] Claude adversarial review on CURRENT HEAD

---

## Claude collaboration checkpoints

| When | Ask Claude |
|------|------------|
| P0 merge | Adversarial review #3787 @ CURRENT HEAD |
| P1 merge | Review dynamic cap + rejection schema |
| P2 | Challenge POSITIONING origin rules |
| P3 | Red-team Cortex swing horizon vetoes |

**Merge gate:** Cursor never merges without Claude **APPROVED** on CURRENT HEAD.

---

## Aggressive wake

`npm run blackout:swing-v2-wake` — every hourly wake + after each PR push.
