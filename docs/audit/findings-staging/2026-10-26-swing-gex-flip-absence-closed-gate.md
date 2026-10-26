> **kind:** FINDING

## collectGexFlipAbsence's gamma-flip absence disclosure never fires for CLOSED/dead-WATCH plays, even though their sections render the exact 'Current dealer posture' content it exists to explain — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief-absence.ts`, `collectBriefUnavailableSources()` (~line
844-952).

**Root cause:** The only disclosure mechanism for a null `gex.flip` —
`collectGexFlipAbsence` (~line 822-841), which looks up `gex.flip_reason` in the
`GEX_FLIP_REASON_DISCLOSURE` table (~807-820) to distinguish a genuine data gap
(`insufficient_strikes`/`crossings_far_from_spot`, retryable) from the honest structural fact
`net_short_everywhere` (non-retryable) — was called only inside `if (!isNotLive) { ... }`
(`isNotLive = isClosed || isDeadWatch`, ~line 893), alongside `collectGexStalenessAbsence`. The
surrounding comment block (~858-867) justifies suppressing live-desk-freshness checks for a
historical CLOSED play ("today's live desk state is current" doesn't apply to it) — correct for
pure STALENESS checks, but `collectGexFlipAbsence` is a different kind of check: it answers "is
there a structural/computational reason the matrix has no flip," and it already internally returns
`null` on a stale or missing matrix (`if (gexMatrixStale(gex, readMs)) return null;`,
`if (!gex || gex.flip != null) return null;`) — bucket status adds nothing to its own correctness,
it only ever suppresses it.

But `gexPostureSection`/`chartLevelsSection` (`play-brief-intel.ts`) explicitly DO render "Current
dealer posture"/"Current levels" content for CLOSED plays (prefixed "_Current ... — not what this
trade traded under._"), gated only on `!stale`, and can hit the identical null-flip/null-gamma_posture
case the live-bucket disclosure was built for — with nothing in `unavailableSources` flagging it
when that happens on a CLOSED/dead-WATCH play.

**Evidence:** same live repro as the companion finding below — CLOSED MRNA (positionId 65),
2026-10-26: "Levels on chart" section has Call wall/Put wall/GEX king lines but no "Gamma flip:"
line; "GEX posture" section has Net GEX/VEX/DEX/CHARM/Nearest-wall lines but no "Gamma posture:
dealers X gamma" line; "Chart technicals" has no "Dealer gamma regime:" line. The brief's own
"Unavailable this turn" list names only "Meridian peer cohort (unclassified_sector)" — nothing
about GEX flip or gamma posture. Contrast: a live/WATCH brief hitting the same null-flip case
already surfaces a "GEX gamma flip" chip (existing coverage in `play-brief-absence.test.ts`,
`net_short_everywhere`/`insufficient_strikes`/`crossings_far_from_spot` cases, all written for the
non-CLOSED bucket) — it simply never runs for CLOSED/dead-WATCH.

**Blast radius:** one function, one gate — `collectGexFlipAbsence` has exactly one call site in the
whole repo (this function). No other consumer of `unavailableSources` duplicates this logic.

**Fix rationale:** narrowed the `isNotLive` gate so it still suppresses the pure staleness check
(`collectGexStalenessAbsence`, left exactly as before — genuinely inapplicable to a closed trade's
historical facts, same reasoning as every sibling check in this function) but lets
`collectGexFlipAbsence` run unconditionally, independent of bucket status — it is gated on "is the
GEX matrix fresh and present" (which it already checks internally) rather than "is this play still
live." This cannot change behavior for the live/non-closed bucket (previously gated the same way,
now simply ungated by bucket — identical result there) and only adds disclosure coverage for
CLOSED/dead-WATCH. Deliberately left unchanged: `collectGexStalenessAbsence`'s own `!isNotLive` gate
(a CLOSED play's "GEX matrix stale" chip would be exactly the "permanent once any time has passed"
noise the original CLOSED-bucket fix (2026-09-07) suppressed), and every other check in this
function (HELIX flow, Vector desk state, discovery/0DTE/Legacy prior-session, etc.) — none of those
are structural/computational absences the way flip-reason is.

**Companion finding:** shares its root cause (null `gamma_posture`/`flip` while `net_gex`/walls are
live) with `2026-10-26-swing-dealer-posture-evidence-gated-on-gamma-posture.md`, fixed in the same
PR. The two interact: fixing only the evidence-array finding would have made the CALC evidence line
appear in `evidence[]` with a missing posture token while this disclosure STILL never explained why
on a CLOSED brief; fixing only this one would have left `evidence[]` silently empty regardless. Fixing both together leaves a CLOSED brief in a strictly better state on this
shared root cause: the evidence array keeps whatever did resolve (net GEX/wall), and
`unavailableSources`/the UI's `UnavailableChip` now explains why the posture word itself did not.

**Test:** `play-brief-absence.test.ts` — two new regression tests: (1)
`collectBriefUnavailableSources: a CLOSED play with a fresh, flip-absent GEX matrix still surfaces
WHY (companion to evidenceFromContext fix)` — asserts the "GEX gamma flip" chip now fires for
`play: { status: "CLOSED" }`; (2) `collectBriefUnavailableSources: a CLOSED play's STALE GEX matrix
still does not surface the generic staleness chip` — a control proving the narrowing didn't
accidentally un-suppress `collectGexStalenessAbsence` too. Verified RED→GREEN via `git stash` on the
source fix alone (new test 1 fails pre-fix: `fail 1` out of 111 in `play-brief-absence.test.ts`;
both pass with the fix restored). Full `play-brief-absence.test.ts`: 113/113 pass.
`src/lib/swing/*.test.ts` (whole directory): 2135/2135 pass. `tsc --noEmit`: clean.
