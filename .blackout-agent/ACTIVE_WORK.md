# ACTIVE WORK

| ID | Owner | Phase | Branch/PR | Title |
|----|-------|-------|-----------|-------|
| BO-SWING-V2-P1P2 | cursor | VERIFYING | `cursor/swing-engine-v2-p1` #3808 | Swing Engine V2 P1+P2 — dynamic recall + POSITIONING origin |
| BO-SWING-V2-DESIGN | cursor | REVIEWING | `cursor/swing-engine-v2-design` #3807 | V2 architecture doc (draft) |

## Standing

- **P0 #3787 MERGED** @ `aea0a0751` (Command Deck parity)
- **Design:** `docs/audit/SWING-ENGINE-V2-DESIGN.md` + `.blackout-agent/SWING-V2-ROADMAP.md`
- **Wake:** `npm run blackout:swing-v2-wake` every cycle
- **Merge gate:** Claude APPROVED on CURRENT HEAD for all Cursor PRs

## Next actions (autonomous)

1. Poll #3808 CI @ `07c87dca1` → request Claude adversarial review
2. Shadow deploy `SWING_ENGINE_V2=1` on staging after merge
3. P3: Cortex(swing) + enforce confluence gate at commit
