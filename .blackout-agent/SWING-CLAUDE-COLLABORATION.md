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

### Merged (round 2 — **COMPLETE** on `main` @ 24aedcf41)
| Q | Fix | PR |
|---|-----|-----|
| Q31+Q32 (Swing) | member Discord alerts | **#3903 MERGED** |
| Q32 (Banger sibling) | member Discord alerts | **#3911 MERGED** |
| Q33–Q35 | shadow mark/close refresh + gate evidence | **#3908 MERGED** |
| Q36 | evidence-only terminal guard | **#3901 MERGED** |
| Q37 | singleton claim + roll revalidation | **#3899 MERGED** |
| Q38 | stale underlying spot guard | **#3893 MERGED** |
| Q39 | ex-dividend structural stop | **#3909 MERGED** |
| Q40+Q41 | markAsOf + SSE tier recheck | **#3895 MERGED** (+ #3906 refinement) |
| discovery spot | WATCH spot freshness | **#3902 MERGED** |

### In PR
_None — round 2 + Q7 P4 complete._

### Merged (round 3 — freshness + Q7 P4)
| Q | Fix | PR |
|---|-----|-----|
| Q7 P4 | `quote_stale` + `daily_bar_incomplete` wired into V2 commit path | **#3934 MERGED** @ `bb871d9b` |
| Freshness | wall persist debounce + auth dedupe future-at guards | **#3933 MERGED** |
| Desk | UW sweep on enrichment fan-out | **#3935 MERGED** |
| SPX desk | GEX age future-skew clamp fix | **#3937 MERGED** |

### Ops (post-merge, not code)
| Item | Status |
|------|--------|
| `SWING_DISCORD_ALERTS=1` + channel ID | Off by default — enable in prod when ready |
| `BANGER_DISCORD_ALERTS=1` + channel ID | Off by default — enable in prod when ready |

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

## Round 2 (Q31–Q41) — **CLOSED** (2026-09-05)

All round-2 items merged (#3893–#3911). Round-3 freshness sweep + Q7 P4 (#3933–#3937) merged. Ops enablement for Discord alerts remains off-by-default until operator flips env vars. Q35 shadow→budget consumption half is intentional P4. Optional cleanup: delete legacy `gates.ts` after test migration (quote/bar now live in v2).
