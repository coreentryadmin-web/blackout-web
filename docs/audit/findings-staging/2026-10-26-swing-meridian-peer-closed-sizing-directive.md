## Ask Largo swing play-brief: "Earnings peer lens" left a live sizing/hedging directive unchanged on CLOSED positions whose contract was genuinely exposed to the print — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Found by** | Live-production audit, Ask Largo × Night Hawk Swings standing ownership mandate, cycle 34, 2026-10-26 |
| **Scope** | `src/lib/swing/play-brief-intel.ts` (`meridianPeerSection`) |

### Root cause

`meridianPeerSection` is the one sibling "live read" section in this file that did NOT follow the
established CLOSED-bucket pattern the rest of the file uses. Every other section that renders a
fresh-every-request market context (`catalystsSection`, `chartLevelsSection`, `gexPostureSection`,
`wallDynamicsSection`, `flowIntelSection`, `meridianCatalystSection`) either unshifts a "not what
this trade traded under" disclaimer AND strips the forward/actionable directive content for a
CLOSED play (`vectorDeskSection`'s and `watchForSection`'s own closed-bucket branches drop entry
zone/targets/invalidation/"Watch now" entirely, keeping only an informational snapshot), or at
minimum disclaim the whole body. `meridianPeerSection` only ever PREPENDED the disclaimer
("_Current earnings peer lens — not what this trade traded under._") — it never touched the
TRAILING live directive text `meridianPeerEarningsCoaching` (`play-brief-meridian-peer-core.ts`)
unconditionally appends: `EARNINGS_PEER_SIZING_INSTRUCTION` ("Peers that beat often gap through
implied — size down or hedge vol unless thesis is the print.") and, when `days_until<=3`,
`EARNINGS_PEER_PRINT_IMMINENT_BULLET` ("**print imminent** — vol crush risk elevated").

The ONLY mechanism that swapped out that live directive was `noGapExposure`
(`expiry != null && expiry < earningsItem.date`) — a signal computed purely from the REVIEWED
CONTRACT's own calendar expiry vs. the earnings print date, entirely independent of whether the
position has since CLOSED. For a CLOSED position whose contract's calendar expiry was still AFTER
the print at commit time — the common case (stopped out early, not simply time-decayed past the
print) — `noGapExposure` is false, so both the sizing directive and the print-imminent bullet
survived completely unmodified alongside the CLOSED-bucket disclaimer, producing a
self-contradicting paragraph: "not what this trade traded under" immediately followed by direct,
actionable, second-person risk-management instructions about a position that no longer exists.

This was not a fresh defect — it is the one remaining gap in a section that had already been fixed
three times this week for adjacent shapes of the same underlying class of bug (the CLOSED-bucket
disclaimer itself, 2026-10-24; the `noGapExposure` sizing-instruction swap, 2026-10-25; stripping
the print-imminent bullet under `noGapExposure`, 2026-10-26) — none of those three fixes ever made
the swap depend on the position's own status bucket, only on the contract's own expiry vs. the
print date, so a CLOSED play whose contract was genuinely still exposed to the print fell through
every one of them untouched.

### Evidence

Live-reproduced against production, 2026-10-26: two real CLOSED swing positions — GOOGL #64 (closed
4 days ago) and GOOGL #59 (closed 10 days ago) — both still rendered the CLOSED disclaimer
immediately followed by actionable "size down or hedge vol" advice about a position the member no
longer holds, because each position's own contract had a calendar expiry still after the relevant
earnings print at the time it was committed/closed (i.e. `noGapExposure` was false for both).

Confirmed in code: `meridianPeerSection` (`play-brief-intel.ts`, pre-fix) only read
`statusBucket(ctx.play)` once, for the `prefix` disclaimer — the subsequent `withoutPrintImminent`/
`adjustedBody` swaps were gated solely on `noGapExposure`, with no reference to the play's bucket
at all.

### Blast radius

Single call site — `meridianPeerSection`'s own body construction. No other section reads
`EARNINGS_PEER_SIZING_INSTRUCTION`/`EARNINGS_PEER_PRINT_IMMINENT_BULLET` or re-derives this swap
independently (`meridianCatalystSection`, the sibling catalyst section, reads a different field
entirely and already carries its own, separately-fixed CLOSED guard). The pure helper
(`meridianPeerEarningsCoaching`, `play-brief-meridian-peer-core.ts`) is untouched — it deliberately
stays play-unaware, same discipline the 2026-10-25/26 fixes already established; this fix is scoped
entirely to the section-assembly layer in `play-brief-intel.ts`, consistent with how every other
bucket-aware adjustment in this function is already applied.

### Fix

Added an independent `isClosed = statusBucket(ctx.play) === "closed"` check alongside the existing
`noGapExposure` one:

- `stripPrintImminent` is now `noGapExposure || isClosed` — the print-imminent bullet is stripped
  whenever EITHER condition holds, not only when the contract itself had already decayed past the
  print.
- The trailing sizing instruction is now swapped under three distinct, non-overlapping outcomes:
  - `noGapExposure` (unchanged, still the OPEN/WATCH-only mechanism it already was): replaced with
    the existing "this contract expires X, on/before the print, so no earnings-gap exposure..."
    sentence — this phrasing stays factually true and worth keeping even for a CLOSED play whose
    contract genuinely never reached the print, per the task's explicit scoping.
  - `isClosed && !noGapExposure` (the gap this fix closes): replaced with a retrospective,
    non-actionable sentence — "This position already closed before this print — no live
    sizing/hedging decision remains on it; peer context above is for reference only." — mirroring
    `vectorDeskSection`'s established pattern of stripping forward directives entirely for the
    CLOSED bucket rather than merely disclaiming them.
  - Neither (OPEN/WATCH, genuinely exposed): unchanged, the real live sizing instruction renders as
    before — no regression to the common, correct case.

The existing null-return guard (`if (noGapExposure && ctx.meridianPeer?.available !== true) return
null;`, added 2026-10-26 for the TEM/CRML/AMPX/AVAV no-cohort case) is untouched — it is scoped to
`noGapExposure` specifically and the new `isClosed` branch does not produce a byte-for-byte
duplicate of any other section's content, so no new duplicate-suppression case is needed.

### Fix rationale

Kept `noGapExposure` exactly as it already was (the OPEN/WATCH-only, contract-expiry-vs-print
mechanism) rather than folding CLOSED into it, because the two signals answer genuinely different
questions — "was this contract ever exposed to the print" vs. "does this position still exist to
act on" — and conflating them would have silently changed the OPEN/WATCH behavior while fixing the
CLOSED one. Chose to mirror `vectorDeskSection`'s own established CLOSED-bucket pattern (strip
forward directives, keep informational content) rather than inventing a new disclosure shape,
since this file already has a working, precedent-setting pattern for exactly this class of
section. Chose a distinct retrospective sentence for `isClosed && !noGapExposure` rather than
reusing the `noGapExposure` "no earnings-gap exposure" sentence, since that sentence would be
factually false here — the position WAS genuinely exposed to the gap at the time it was open; what
changed is that it no longer exists to act on, not that it was never exposed.

### Regression test

- `src/lib/swing/play-brief-intel.test.ts`:
  - Extended "meridianPeerSection: CLOSED bucket prefixes a current-not-as-traded disclosure" — its
    fixture previously carried NO contract/expiry data at all, so it never exercised this gap. Gave
    both the CLOSED and OPEN fixture plays a real `occ` (expiry after the print, i.e.
    `noGapExposure` false) and added assertions that the CLOSED section drops the sizing
    instruction and renders the new retrospective sentence, while the OPEN section keeps the real
    sizing instruction unchanged (no regression).
  - Extended "meridianPeerSection: contract still alive through the print keeps the sizing/hedging
    instruction unchanged (no regression)" with an identical-contract CLOSED sibling case, asserting
    the sizing instruction is swapped for the retrospective sentence (not left "unchanged" the way
    the OPEN case correctly is) while real peer stats (KTOS) survive.
  - Extended "meridianPeerSection: imminent (<=3d) print the position is still exposed to keeps the
    'print imminent' bullet (no regression)" with an identical-contract CLOSED sibling case,
    asserting BOTH the print-imminent bullet and the sizing instruction are neutralized together —
    this is the exact live GOOGL #64/#59 repro shape (imminent print + genuinely-exposed contract +
    CLOSED position).

### Verification

- RED→GREEN proof: ran the 3 extended tests against the pre-fix code (`git stash` equivalent via
  reverting the implementation hunk) — exactly the 3 new/extended assertions failed (342 pass / 3
  fail); applying the fix brought the full file back to 345/345 pass, 0 fail.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` (Node
  20) — 345/345 pass, 0 fail.
- Full `npm test` (Node 20) — pass, 0 fail (see PR for exact count).
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
