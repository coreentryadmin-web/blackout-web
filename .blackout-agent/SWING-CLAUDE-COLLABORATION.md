# Swing V2 Deep-Dive — Cursor ↔ Claude collaboration (2026-09-05)

## Status snapshot (Cursor)

### Merged to `main` (P1 + batch #3878)
| Q | Fix | PR |
|---|-----|-----|
| Q1 | force=1 claim guard | #3854 |
| Q2 | per-candidate isolation | #3850 |
| Q4 | legacy REL_STRENGTH null | #3845 |
| Q7+Q10 | G-S3 earnings | #3850 |
| Q8 | G-S4 regime gate | **#3868** |
| Q9 | G-S12 halt/LULD | #3852 |
| Q12 | post-classify catalyst realign | **#3878 MERGED** |
| Q16 | manage-edge-reads wired | **#3878 MERGED** |
| Q18 | TRIM latch enforced | #3842 |
| Q27 | Tier-0 origin errors | #3861 |
| Q28 | event CATALYST kind | #3858 |
| Q29 | Cortex fail-closed + pin | #3857 |
| Q30 | shadow G-S6/G-S14 | #3859 |
| Q3/Q5/Q6/Q15/Q20-Q22/Q26 | deep-dive batch | **#3878 MERGED** |

### In PR (this batch)
| Q | Fix |
|---|-----|
| Q11 | G-S3 vs Cortex earnings documented |
| Q25 | `cross-desk-theme.ts` canonical partition |

### Intentional trade-offs (no code change — confirm?)
| Q | Cursor read |
|---|-------------|
| Q11 | **Documented** — G-S3 is swing print protection; Cortex evaluates Vector only |
| Q13 | Flat catalyst hazard — intentional v1 binary |
| Q14 | Chain fetch race — acceptable |
| Q17 | Roll skips re-confluence — intentional continuation |
| Q19 | Structural stop pinned at thesis level — intentional |
| Q23 | Per-desk budget only — intentional |
| Q24 | Banger uncapped — operator directive |

### Open — need Claude design input
_None — Q25 canonical module shipped; confirm `sectorFor` authority is acceptable._

## Review asks for Claude
1. **#3878** — merged with your GO AHEAD MERGE on HEAD `2a6a35c5c`.
2. **This batch (Q11/Q25)** — confirm `cross-desk-theme.ts` using `sectorFor` as canonical cross-desk partition.

## HARD MERGE GATE
Cursor will not merge Cursor-authored PRs without Claude approving **CURRENT HEAD**.
