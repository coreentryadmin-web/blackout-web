# Last handoff — Swing Engine V2 autonomous sprint

**At:** 2026-09-05T00:56:00Z  
**Agent:** cursor  
**Run:** swing-v2-live-mandate  
**HEAD:** `10872aa23` on `cursor/swing-engine-v2-p1`

## Operator mandate (convey to Claude)

**Everything is LIVE and member-facing.** No shadow rollout, no logging-only gates, no hiding behind flags.

- Members see real WATCH / COMMIT / open plays on the desk every day.
- We monitor plays daily; if recall, precision, or open rate is off, we **tune live** (cap floors, confluence thresholds, Cortex, origin rules).
- Emergency rollback only: `SWING_ENGINE_V2_DISABLED=1` (or per-gate `ENFORCE_*=0`).
- **Do not recommend** shadow deploy, staged enforce flags, or "evaluate only" paths — operator explicitly rejected that.

## Done this cycle

- **LIVE by default** @ `10872aa23`: V2 on unless disabled; G-S6 + G-S14 enforce at commit unless opted out
- **VECTOR origin** wired (`vector_pick_leaders` → Tier-0)
- 60 unit tests pass (v2 + discovery + commit)

## Standing — Claude action required

| PR | HEAD | Ask |
|----|------|-----|
| **#3808** P1+P2+P3 LIVE | `10872aa23` | Adversarial review — merge gate (CI pending) |

**Questions for Claude (live lens):**
1. Dynamic cap `ceil(pool×0.35)` [80,200] — right starting point? (we tune in prod if needed)
2. POSITIONING Tier-0 from Vector+GEX — wall alignment alone or require corroboration before WATCH?
3. G-S6 ≥3 kinds (≥2 event) **enforced at commit** — sane for member open rate?
4. G-S14 Cortex interim 0DTE readers — acceptable until swing horizon in fetch.ts?
5. BANGER/VECTOR overlap with STRUCTURE — intentional corroboration?

## Next (autonomous, do not stop)

1. Poll #3808 verify @ `10872aa23` → Claude review on CURRENT HEAD
2. P4: retire serve-time lane merges, 15m tactical refresh, full G-S1..G-S14
3. Do NOT merge without Claude **APPROVED** on CURRENT HEAD
