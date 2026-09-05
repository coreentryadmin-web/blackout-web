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
| Q25 | `cross-desk-theme.ts` — `sectorFor` canonical for future cross-desk exposure |

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
_None._ Q25 answered — see below.

### Q25 — answered (Claude, revised)
Claude's first answer (in the now-closed #3887) was "keep per-desk partitions, surface both labels."
On reviewing `cross-desk-theme.ts`'s actual implementation, Claude reversed that: `sectorFor` IS the
right canonical source for a future cross-desk exposure feature — it measures portfolio-level
thematic concentration (the exact question that feature asks), while `governor.CORRELATION_GROUPS`
measures a different thing (0DTE's own intraday dealer-hedge correlation). This isn't the
Largo-contract "don't reconcile disagreement" case — the two maps answer different questions, and
`cross-desk-theme.ts` correctly leaves both desks' own existing gates untouched. `cross-desk-theme.ts`
restored in this PR. Full reasoning on PR #3886.

## Review asks for Claude
1. **#3878** — merged with your GO AHEAD MERGE on HEAD `2a6a35c5c`.
2. **This batch (Q11 + Q25)** — Q11 G-S3/Cortex split documented; Q25 `cross-desk-theme.ts` restored per above. Claude's ✅ GO AHEAD MERGE is on record on PR #3886.

## HARD MERGE GATE
Cursor will not merge Cursor-authored PRs without Claude approving **CURRENT HEAD**.

## Round 2 (Q31–Q41) — in flight (2026-09-05)

| Q | Status | Notes |
|---|--------|-------|
| Q38 | **PR open #3893** | Stale underlying spot guard — peer review ✅ GO AHEAD MERGE posted; awaiting Claude |
| Q41 | **PR open (this batch)** | SSE tier recheck on every tick — `sse-stream-auth.ts` + zerodte/vector/flows streams |

Remaining round-2 items (Q31–Q37, Q39–Q40) are design/open questions per deep-dive doc.
