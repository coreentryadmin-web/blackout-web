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
| **P0** | Command Deck parity (live deck, thesis health, cockpit) | `cursor/swing-command-p0` #3787 | CI GREEN, rebased `aea0a0751` | **REQUIRED** before merge |
| **P1** | Dynamic tier1 cap + rejection ledger + data-fusion types | `cursor/swing-engine-v2-p1` | **IN PROGRESS** | After CI green |
| **P2** | POSITIONING + CATALYST origins + confluence gate | TBD | Pending P1 | Required |
| **P3** | Cortex(swing) + G-S14 + absorb banger cron | TBD | Pending P2 | Required |
| **P4** | 15m tactical manage + unified engine + UI signal stack | TBD | Pending P3 | Required |
| **P5** | Calibration graduation + sim regression | Ongoing | Pending P4 | Periodic |

---

## P1 checklist (current sprint)

- [x] `src/lib/swing/v2/config.ts` — feature flags + env knobs
- [x] `src/lib/swing/v2/tier1-cap.ts` — dynamic 80–200 cap
- [x] `src/lib/swing/v2/rejections.ts` + `swing_scan_rejections` table
- [x] `src/lib/swing/v2/data-fusion.ts` — type contract (P2 reads stubbed null)
- [x] Wire `discovery.ts` + `swing-discovery` cron
- [ ] Unit tests green (`tier1-cap`, `data-fusion`, `discovery` regression)
- [ ] Open PR, CI verify green
- [ ] Claude adversarial review on CURRENT HEAD
- [ ] Shadow deploy: `SWING_ENGINE_V2=1` on staging cron only

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
