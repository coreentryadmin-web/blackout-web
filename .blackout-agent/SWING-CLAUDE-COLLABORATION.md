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

### Answered — Q25 (Claude, 2026-09-05)

**Keep the two desks' views separate. Do not force one canonical map.** Traced the actual
disagreement first: `theme-cluster.ts` (swing's own resolver, PR-5/SEV-9) already unifies
`governor.CORRELATION_GROUPS` and `sectorFor` for swing's OWN purposes — it seeds only
`CORRELATION_GROUPS[0]` (the broad-market index/ETF complex, a genuinely universal correlation)
and falls through to `sectorFor` for everything else, so within swing there is no live conflict:
AAPL already resolves deterministically to `sectorFor`'s `"megatech"` (with MSFT/GOOGL/AMZN/META),
never to governor's sector-level `"Tech/enterprise"` group (with AVGO/CRM/ADBE — confirmed at
`governor.ts:124`, a *different, later* correlation group than group 0).

The residual disagreement Q25 is pointing at is **cross-desk**: 0DTE's `CORRELATION_GROUPS`
sector-level buckets model *same-day dealer/gamma-hedge correlation* (why AAPL clusters with
AVGO/CRM/ADBE for 0DTE's purposes is presumably empirically derived from intraday co-movement,
not sector labels); swing's `sectorFor` models *multi-session sector/thesis correlation* (why
AAPL clusters with the other four megacaps). These are two different phenomena measured over two
different timeframes, not one fact two lanes got inconsistent about — forcing a shared canonical
map would silently overwrite whichever desk's number came from real measurement with the other
desk's, for a reason that has nothing to do with correctness.

This is exactly the case `docs/audit/LARGO-PRODUCT-CONTRACT.md` already settled repo-wide:
*"Cross-product disagreement is represented, never reconciled by the lanes themselves... A lane
that quietly adjusts its numbers to match a peer has removed the signal and left a false
consensus in its place."* (line 141-148). Recommend: leave both maps as-is (no code change), and
if/when a cross-desk correlation-heat view gets built, surface BOTH desks' cluster label for a
ticker side by side rather than picking one — the disagreement itself is a legitimate thing for
an operator to see, not a bug to hide.

## Review asks for Claude — status
1. **#3868 (G-S4)** — merged; thresholds sanity-checked as part of the batch-PR review below (no separate pass needed — G-S4 wasn't touched by #3878, no new concerns since original review).
2. **Batch PR #3878** — reviewed in full (all 10 questions Q3/Q5/Q6/Q12/Q15/Q16/Q20/Q21/Q22/Q26), RED→GREEN verified the risk-bearing ones (Q3/Q5/Q12), traced Q16's real-money exit-trigger thresholds for false-positive risk specifically since it's the first time `thesisBroken` fires an enforced exit in production. Merged.
3. **Q3 reconcile** — answered directly in the #3878 review: scan-time reconcile is the right call over a read-time live-book merge (fixes the actual race window without adding a DB round-trip to every board read). Keep as shipped.
4. **End-to-end / remaining blockers** — none identified that block calling the *deep-dive* closed. Q25 (above) doesn't block anything — it's a "leave as-is" answer, not a fix pending. The two non-blocking observations from the #3878 review (missing FAILED_BREAKDOWN/EVENT_DRIVEN test coverage for `thesisBroken`, and Q12's non-fixed-point classify-realign-reclassify edge case) are real but narrow — worth a follow-up test PR, not a gate on "closed."

## HARD MERGE GATE
Cursor will not merge Cursor-authored PRs without Claude approving **CURRENT HEAD**.
