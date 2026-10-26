## "Earnings peer lens" rendered as a pure, byte-for-byte duplicate section when no peer cohort resolved and the contract has no earnings-gap exposure — FIXED

> **kind:** `FINDING`

**Status.** FIXED (PR pending).

### Area

Night Hawk Swings — Ask Largo play-brief, `src/lib/swing/play-brief-intel.ts`'s
`meridianPeerSection`. Standing Ask Largo × Night Hawk Swings ownership mandate (CLAUDE.md).

### Found by

Live play-brief deep-dive against `docs/audit/LARGO-PRODUCT-CONTRACT.md` (narrative-quality /
"reads like a connected trade-manager voice, not a bullet dump" angle), 2026-10-26. Hit
`GET /api/market/swing/play-brief` for 8 live committed/watch swing plays (SOXX, PLTR, MDB, CRML,
AMPX, AVAV, TEM, FLY) and read each envelope's full section set closely.

### Symptom

Live TEM 71C brief (HOLD bucket, entry $1.74, earnings in 7d on 2026-11-02 premarket, contract
expiry 2026-10-30 — strictly before the print):

- **"Trade manager read"** (folds in `catalystCoaching`): *"Earnings in 7d (2026-11-02
  (premarket)) — this contract expires 2026-10-30, on/before the print, so no earnings-gap
  exposure from this position (a concurrent sibling with a later expiry may still be exposed —
  check its own brief)."*
- **"Earnings peer lens"** (`meridianPeerSection`, a separate, standalone section two sections
  later in the SAME brief): *"Earnings peer lens — reports in 7d. This contract expires
  2026-10-30, on/before the print, so no earnings-gap exposure from this position (a concurrent
  sibling with a later expiry may still be exposed — check its own brief)."*

The two sections are not contradictory (that exact contradiction was already fixed, 2026-10-25,
PR #6747/OUST live repro) — they now agree, which is correct — but "Earnings peer lens" adds
**zero new information** here: every word past "reports in 7d" is a verbatim restatement of the
sentence Trade manager read already gave. The same pattern reproduces identically for every other
live Banger-origin small-cap checked with no resolvable Meridian sector peer cohort and a
near-expiry contract (CRML 6.5C, AMPX 8.5C, AVAV 130C all carry `unavailableSources: [{source:
"Meridian peer cohort" or "peers", ...}]` plus a contract expiring before/at their next earnings
window — AMPX/AVAV's own earnings are >14d out so the section correctly doesn't fire for them,
but the defect is confirmed live and reproduced exactly in a regression test built from TEM's real
numbers).

### Root cause

The 2026-10-25 fix (`meridianPeerSection`, PR #6747) swapped `meridianPeerEarningsCoaching`'s
trailing `EARNINGS_PEER_SIZING_INSTRUCTION` ("Peers that beat often gap through implied — size
down or hedge vol unless thesis is the print") for the identical no-earnings-gap-exposure sentence
`catalystCoaching` already renders, whenever `ownContractExpiry(ctx)` resolves strictly before the
earnings print date (`noGapExposure`). Its own write-up explicitly reasoned that "the informative
peer-beat-rate statistics earlier in the body are left untouched (they remain useful context even
for a position that is not itself exposed to the gap)" — correct when a peer cohort actually
resolved (sector label, interpretation, subject print history, peer beat-rate snippets). But when
`ctx.meridianPeer.available !== true` (no resolvable sector peer cohort — the common case for
Banger-lane small-caps, confirmed live for TEM/CRML/AMPX/AVAV/FLY), `meridianPeerEarningsCoaching`
never enters its `peer && peer.available` branch, so nothing beyond the baseline "reports in Nd"
line survives. Once the swap also replaces the trailing instruction, the ENTIRE remaining section
content is "reports in Nd. &lt;the sentence Trade manager read already said&gt;" — a section slot
occupied for no reason, the exact "bullet-dump" failure class `whyThisSetupSection`'s own 2026-09-06
`recNote`-duplication fix (FINDINGS.md) was built to prevent, just arrived at via a different code
path.

### Fix

Added a guard at the end of `meridianPeerSection`: when `noGapExposure` is true AND
`ctx.meridianPeer?.available !== true`, return `null` instead of the section. Scoped deliberately
narrow:
- A resolved peer cohort with real content (sector label / interpretation / subject print history
  / peer beat-rate snippets / thin-cohort disclosure) is untouched — the 2026-10-25 fix's own
  regression tests (OUST, MSFT) still pass unmodified, since those fixtures carry
  `meridianPeer.available: true` with real `members`.
- A contract genuinely EXPOSED to the print (`noGapExposure` false) still renders the section even
  with no peer cohort, because "Peers that beat often gap through implied — size down or hedge
  vol" is then distinct advice from Trade manager read's own earnings bullet, not a duplicate of
  it.
- Suppressing the section loses no Largo C3 disclosure — the peer cohort's own absence is already
  carried separately in `unavailableSources` ("Meridian peer cohort" / "peers").

### Evidence (RED → GREEN)

Added 2 tests to `src/lib/swing/play-brief-intel.test.ts`:
1. `meridianPeerSection: no peer cohort + contract expiring before the print returns null instead
   of a pure-duplicate section (live repro TEM 71C)` — builds the exact live TEM shape
   (`meridianPeer: {available: false}`, contract expiring before the earnings date) and asserts
   the section is `null`.
2. `meridianPeerSection: no peer cohort but contract still exposed to the print still renders (no
   regression)` — same no-cohort shape, but contract expiry AFTER the print date, asserts the
   section still renders with the real sizing/hedging instruction.

`git diff` isolated to `play-brief-intel.ts` reverted, test kept: RED —
`not ok 272 - meridianPeerSection: no peer cohort + contract expiring before the print returns
null...` (actual body was the live byte-for-byte duplicate quoted above), 342/343 pass in that
file. Fix restored: GREEN — 343/343 in `play-brief-intel.test.ts`.

Full `src/lib/swing/*.test.ts`: 2116/2116 pass. `npx tsc --noEmit`: clean (0 errors).

### Blast radius

Single call site: `meridianPeerSection` is the only section-assembly caller of
`meridianPeerEarningsCoaching`/`pickEarningsForSwingPeer` (confirmed via `grep -rn
"meridianPeerEarningsCoaching\|pickEarningsForSwingPeer" src/lib/swing/*.ts` outside
`play-brief-meridian-peer-core.ts`/`play-brief-meridian-peer.ts`). No change to
`meridianPeerEarningsCoaching` itself, `ownContractExpiry`, or `catalystCoaching` — all three stay
exactly as the 2026-10-25/26 fixes left them.

### Deliberately left unchanged

- The 2026-10-24 CLOSED-bucket disclosure guard and the 2026-10-25/26 no-gap-exposure /
  print-imminent swaps in `meridianPeerSection` — already correct for their own cases; this fix is
  additive alongside them.
- The rarer degenerate shape where `meridianPeer.available === true` but every optional field
  (sector_label, interpretation, members, insufficient_reason) is empty — not observed live in
  this pass; left for a future measurement rather than guessed at.
