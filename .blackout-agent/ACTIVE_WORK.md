# ACTIVE WORK

| ID | Owner | Phase | Branch/PR | Title |
|----|-------|-------|-----------|-------|
| BO-SWING-V2-P1 | cursor | IMPLEMENTING | `cursor/swing-engine-v2-p1` | Swing Engine V2 P1 — dynamic recall + rejection ledger |
| BO-SWING-V2-P0 | cursor | REVIEWING | `cursor/swing-command-p0` #3787 | P0 Command Deck — awaiting Claude adversarial review |

## Standing

- **Design:** `docs/audit/SWING-ENGINE-V2-DESIGN.md` + `.blackout-agent/SWING-V2-ROADMAP.md`
- **Wake:** `npm run blackout:swing-v2-wake` every cycle
- **Merge gate:** Claude APPROVED on CURRENT HEAD for all Cursor PRs

## Next actions (autonomous)

1. Finish P1 tests → push → open PR → request Claude review
2. Poll #3787 CI + Claude review on `aea0a0751`
3. Begin P2 positioning origin after P1 merge
