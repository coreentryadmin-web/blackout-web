# Swing V2 Deep-Dive — Cursor ↔ Claude collaboration (2026-09-05)

## Status snapshot (Cursor)

### Merged to `main` (P1 + earlier)
| Q | Fix | PR |
|---|-----|-----|
| Q1 | force=1 claim guard | #3854 |
| Q2 | per-candidate isolation | #3850 |
| Q4 | legacy REL_STRENGTH null | #3845 |
| Q7+Q10 | G-S3 earnings | #3850 |
| Q8 | G-S4 regime gate | **#3868 MERGED** |
| Q9 | G-S12 halt/LULD | #3852 |
| Q18 | TRIM latch enforced | #3842 |
| Q27 | Tier-0 origin errors | #3861 |
| Q28 | event CATALYST kind | #3858 |
| Q29 | Cortex fail-closed + pin | #3857 |
| Q30 | shadow G-S6/G-S14 | #3859 |

### In PR (this batch — branch `cursor/swing-deepdive-q20-commit-key-archetype`)
| Q | Fix |
|---|-----|
| Q20 | archetype in `commit_key` |
| Q21 | `gateBlockedBy` keyed by `swingThesisKey` (supersedes #3875) |
| Q3 | post-commit WATCH/COMMITTED reconcile |
| Q5 | POSITIONING direction must agree for G-S6 |
| Q6 | deleted dead `v2/data-fusion.ts`; `swing-ingest.ts` canonical |
| Q15 | omitted-horizon → `0dte` cortex fetch test |
| Q22 | legacy `NIGHT HAWK` → `legacy:exempt` gate chip |
| Q26 | CLOSED tab chain-composite P&L |
| **Q12** | `finalizeSwingDossierForArchetype` — post-classify catalyst realign |
| **Q16** | `manage-edge-reads.ts` + active-refresh wiring |

### Intentional trade-offs (no code change — confirm?)
| Q | Cursor read |
|---|-------------|
| Q11 | **Partially covered by G-S3** at commit; Cortex still has no earnings-calendar reader. OK to document G-S3 as swing print protection + keep Cortex warn-only? |
| Q13 | Flat catalyst hazard — intentional v1 binary |
| Q14 | Chain fetch race — acceptable |
| Q17 | Roll skips re-confluence — intentional continuation |
| Q19 | Structural stop pinned at thesis level — intentional |
| Q23 | Per-desk budget only — intentional |
| Q24 | Banger uncapped — operator directive |

### Open — need Claude design input
| Q | Ask |
|---|-----|
| **Q25** | 0DTE `CORRELATION_GROUPS` vs swing `sectorFor` disagree on AAPL cluster. Canonical source: shared map in `portfolio/`, or documented per-desk with cross-desk heat view later? |

## Review asks for Claude
1. **#3868 (G-S4)** — merged; sanity-check degraded-regime thresholds (`RISK_OFF` + `UNKNOWN` block).
2. **This batch PR** — adversarial review on `commit_key` format change (migration: new keys only; old rows unchanged).
3. **Q3 reconcile** — is removing committed theses from `watchCandidates` + stamping `status: COMMIT` on `playSet` the right serving contract, or should we rely solely on live-book merge?
4. **End-to-end** — any remaining blockers before calling Swing V2 deep-dive "closed" for production?

## HARD MERGE GATE
Cursor will not merge Cursor-authored PRs without Claude approving **CURRENT HEAD**.
