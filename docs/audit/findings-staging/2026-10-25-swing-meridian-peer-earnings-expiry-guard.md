## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] "Earnings peer lens" ignores the SAME brief's own "no earnings-gap exposure" computation and issues contradictory risk-management guidance for a contract that already expires before the print — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD, this branch) |
| **Found by** | Adversarially-verified live audit (Ask Largo standing mandate, CLAUDE.md "ASK LARGO × NIGHT HAWK SWINGS" section) |
| **Finding ID** | OUST, SWING:OUST:2127 |
| **Scope** | `src/lib/swing/play-brief-meridian-peer-core.ts`, `src/lib/swing/play-brief-intel.ts`, `src/lib/swing/play-brief-narrative-coaching.ts` |

### Root cause

Live OUST 31C play-brief (expiry 2026-10-30, entry $0.78, HOLD bucket) gave OPPOSITE risk
conclusions about the SAME 2026-11-03 earnings print from two sections of the SAME brief:

- **"Trade manager read"** (`catalystCoaching`, `play-brief-narrative-coaching.ts`): *"Earnings in
  9d (2026-11-03 (afterhours)) — this contract expires 2026-10-30, on/before the print, so no
  earnings-gap exposure from this position..."* — correct.
- **"Earnings peer lens"** (`meridianPeerSection`/`meridianPeerEarningsCoaching`, a separate,
  standalone section, NOT folded into Trade manager read): *"Earnings peer lens — reports in 9d.
  Peers that beat often gap through implied — size down or hedge vol unless thesis is the
  print."* — contradicts the first section about the identical print on the identical contract.

`catalystCoaching` already resolves THIS brief's own contract expiry via `ownContractExpiry(ctx)`
(parses `play.occ`, falling back to a `laneRows` entry-premium match) and compares it against the
earnings date before deciding whether the position has real earnings-gap exposure — this is the
already-fixed path (that same file's own 2026-09-11 fix comment documents an identical prior bug
in THIS exact function: "both briefs printed the identical 'size down or exit before report'
instruction — nonsensical for the position that will already be closed/expired before the print
ever lands").

`meridianPeerEarningsCoaching` (`play-brief-meridian-peer-core.ts`) gates only on
`item.days_until <= 14` and unconditionally appends the literal sizing/hedging instruction
("Peers that beat often gap through implied — size down or hedge vol unless thesis is the
print.") — it never checks the brief's own contract expiry at all, so it structurally cannot
distinguish "this contract is exposed to the print" from "this contract already expired before
the print." The section-assembly wrapper, `meridianPeerSection` (`play-brief-intel.ts`), only
special-cased the CLOSED status bucket (a 2026-10-24 fix prepending a "not what this trade traded
under" disclosure) — there was no analogous guard for an OPEN/HOLD position whose own contract
expires on/before the earnings date.

### Evidence

Live repro: OUST 31C, expiry 2026-10-30, earnings 2026-11-03 (afterhours), HOLD bucket — the two
quoted bullets above, verbatim, from the same rendered brief.

RED→GREEN (`src/lib/swing/play-brief-intel.test.ts`): new test
"meridianPeerSection: contract expiring BEFORE the earnings print discloses no-exposure instead
of telling the trader to size down (live repro OUST 31C, SWING:OUST:2127)" builds the exact live
shape (Meridian earnings item dated 2026-11-03, `play.occ` resolving to a 2026-10-30 expiry) and
asserts the section states "no earnings-gap exposure from this position" and does **not** contain
"size down or hedge vol." Reverting only the three source files to `origin/main` (keeping the new
test) and running `npx tsx --experimental-test-module-mocks --test
src/lib/swing/play-brief-intel.test.ts` reproduced the exact live contradiction and failed with:

```
not ok 264 - meridianPeerSection: contract expiring BEFORE the earnings print discloses
no-exposure instead of telling the trader to size down (live repro OUST 31C, SWING:OUST:2127)
  error: The input did not match the regular expression /expires 2026-10-30/. Input:
  '**Earnings peer lens** — implied move **12.0%** · reports in **9d** · sector **Industrials** ·
  peer history: **KTOS** 75% beat (n=4). Peers that beat often gap through implied — size down or
  hedge vol unless thesis is the print.'
```

(331/332 passed; only the new contradiction-reproducing test failed.) Restoring the fix made the
full suite pass again: `src/lib/swing/play-brief-intel.test.ts` 332/332,
`src/lib/swing/play-brief-meridian-peer.test.ts` + `play-brief-narrative-coaching.test.ts` +
`play-brief.test.ts` combined 389/389, and the full `src/lib/swing/*.test.ts` sweep 2082/2082.
A sibling regression test ("contract still alive through the print keeps the sizing/hedging
instruction unchanged (no regression)") proves the ordinary, correct case (contract expiry AFTER
the print date) is untouched — it still renders the real "size down or hedge vol" instruction.
`npx tsc --noEmit` across the whole project: 0 errors.

### Blast radius

- `meridianPeerEarningsCoaching` (`play-brief-meridian-peer-core.ts`) is the only producer of the
  literal sizing/hedging instruction text; it is now exported as
  `EARNINGS_PEER_SIZING_INSTRUCTION` so the assembly layer can detect/replace it without
  re-deriving the string. No other call site renders this exact instruction.
- `ownContractExpiry` (`play-brief-narrative-coaching.ts`) was previously module-private; it is now
  exported so `meridianPeerSection` can reuse the EXACT same expiry resolution `catalystCoaching`
  already uses, rather than re-deriving a second, potentially-drifting copy of the same logic (the
  same "reuse, don't re-derive" discipline this repo's other fixes in this area already follow).
  No behavior of `ownContractExpiry` itself changed.
- `meridianPeerSection` is the only section-assembly call site for
  `meridianPeerEarningsCoaching`/`pickEarningsForSwingPeer` (confirmed via `grep -rn
  "meridianPeerEarningsCoaching\|pickEarningsForSwingPeer" src/lib/swing/*.ts` outside
  `play-brief-meridian-peer-core.ts`/`play-brief-meridian-peer.ts`) — no other renderer needed the
  same guard.
- `play-brief-meridian-peer.ts` only re-exports `meridianPeerEarningsCoaching`/
  `pickEarningsForSwingPeer` from the core file untouched; it carries no logic of its own and did
  not need a change.

### Fix rationale

Added the guard at the **section-assembly layer** (`meridianPeerSection`, `play-brief-intel.ts`),
not inside the pure `meridianPeerEarningsCoaching` helper — matching the precedent this exact
function already established on 2026-10-24 for its CLOSED-bucket disclosure fix ("stays
pure/play-unaware — the disclosure is prepended here... rather than threading bucket into the
pure helper"). The guard computes `ownContractExpiry(ctx)` (reused, not re-derived) and compares it
against the Meridian catalyst item's own `date`; when the brief's own contract expires strictly
before the print's calendar date, the trailing sizing/hedging instruction is swapped for a
clarifying no-exposure caveat using the identical wording `catalystCoaching` already renders for
the same fact, while the informative peer-beat-rate statistics earlier in the body are left
untouched (they remain useful context even for a position that is not itself exposed to the gap).

Deliberately scoped **narrower** than `catalystCoaching`'s own `noGapExposure` check: that check
also treats a same-day expiry as safe when the UW-sourced `arsenal.earnings.report_time` bucket
confirms the print is afterhours. The Meridian `LargoTimelineItem` this section reads carries only
an ET release `time` string (`HH:mm` or `null`), not a report_time bucket, so there is no reliable
way to resolve the same-day-but-confirmed-after-close case here without guessing. Per this file's
existing honest-absence discipline (unknown timing never claims safety), only the unambiguous case
— contract expiry strictly BEFORE the earnings print's calendar date, safe regardless of intraday
timing — is handled; a same-day expiry falls through unchanged (still renders the original
instruction), exactly as it did before this fix, rather than fabricating a timing fact this data
source cannot confirm.

### Deliberately left unchanged

- `catalystCoaching` itself (`play-brief-narrative-coaching.ts`) — already correct; not modified.
- The 2026-10-24 CLOSED-bucket guard in `meridianPeerSection` — already correct for its own case;
  this fix is additive alongside it (both guards can fire independently and are tested together).
- The same-day-expiry edge case for the peer-earnings path (expiry equals the print's calendar
  date) — genuinely unresolvable from the data this section has available; left as a disclosed,
  narrower scope than `catalystCoaching`'s own check rather than guessing.
