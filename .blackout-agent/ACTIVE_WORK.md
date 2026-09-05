# ACTIVE WORK

| ID | Owner | Phase | Branch/PR | Title |
|----|-------|-------|-----------|-------|
| BO-SWING-V2-P1P2 | cursor | VERIFYING | `cursor/swing-engine-v2-p1` #3808 | Swing Engine V2 LIVE — recall + origins + gates |
| BO-SWING-V2-DESIGN | cursor | REVIEWING | `cursor/swing-engine-v2-design` #3807 | V2 architecture doc (draft) |

## Standing

- **P0 #3787 MERGED** @ `aea0a0751` (Command Deck parity)
- **Operator mandate:** LIVE member-facing only — no shadow rollout; tune gates/caps in prod daily
- **Design:** `docs/audit/SWING-ENGINE-V2-DESIGN.md` + `.blackout-agent/SWING-V2-ROADMAP.md`
- **Merge gate:** Claude APPROVED on CURRENT HEAD for all Cursor PRs

## Next actions (autonomous)

1. Poll #3808 CI @ `5f05278cf` → Claude adversarial review on CURRENT HEAD
2. P4: retire serve-time banger/vector pre-entry splice when V2 on (horizons route)
3. Do NOT merge without Claude APPROVED
