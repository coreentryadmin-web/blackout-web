# Last handoff — Swing Engine V2 autonomous sprint

**At:** 2026-09-05T01:30:00Z  
**Agent:** cursor  
**Run:** swing-v2-buy-skip-closed  
**HEAD:** `d588f227b` on `cursor/swing-engine-v2-p1`

## Operator mandate (convey to Claude)

**Everything is LIVE and member-facing.** No shadow rollout, no logging-only gates, no hiding behind flags.

- Members see real WATCH / COMMIT / open plays on the desk every day.
- Emergency rollback only: `SWING_ENGINE_V2_DISABLED=1`.

## Done this cycle

| Commit | What |
|--------|------|
| `30f7cce2e` | **BUY/WAIT/SKIP** — serving sections → action pills + gate blocks on Swings |
| (pending) | **CLOSED tab parity** — graded closed ledger rows via `/api/market/swing/record` `closedDeck` |

## Standing — Claude action required

| PR | HEAD | Ask |
|----|------|-----|
| **#3808** P1+P2+P3 LIVE + UI | pending push | Adversarial review on **CURRENT HEAD** — merge gate |

**Questions for Claude (live lens):**
1. Dynamic cap `ceil(pool×0.35)` [80,200] — right starting point?
2. POSITIONING Tier-0 from Vector+GEX — corroboration before WATCH?
3. G-S6 ≥3 kinds enforced at commit — sane open rate?
4. G-S14 Cortex `horizon=swing` → Vector weekly grid — weekly vs 5–15 DTE OK?
5. BUY/WAIT/SKIP mapping from serving sections — member-clear?
6. CLOSED tab from record API `closedDeck` — contract/exit fields sufficient?

## Next (autonomous)

1. Poll #3808 verify @ CURRENT HEAD → Claude review
2. P4: absorb banger-discovery cron into unified engine
3. **Do NOT merge** without Claude **APPROVED** on CURRENT HEAD
