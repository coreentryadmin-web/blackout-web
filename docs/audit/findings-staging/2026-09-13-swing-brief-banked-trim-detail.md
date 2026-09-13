> **kind:** FINDING

## Ask Largo swing play-brief: blended P&L was opaque arithmetic a member had to trust — now shows the fired rung(s) that produced it — ENHANCEMENT (shipped)

| **Status** | FIXED |
|---|---|

### Root cause / gap

Not a correctness bug — the blended P&L composite (`blendedPnlPct`, `play-brief.ts`, shipped
earlier this session per its own in-code history) is itself correct. But once a trim-scale
ladder has banked a tranche, the Position section showed only the final blended number:

```
P&L: +2.4% (open runner only — trim already banked, see below)
Peak: +129.7%
Blended P&L (realized trim + open runner): +51.2%
```

A member reading this has no way to verify `+51.2%` without independently knowing the ladder's
own fired rung(s) — which fraction banked, at what trigger, and at what absolute premium level.
Found while deep-auditing CRWD's live brief this session (Night Hawk Swings standing mandate):
the blend checked out correct by hand (0.5×100% + 0.5×2.4% = 51.2%), but only because I already
knew `SWING_SCALE_OUT_POLICY`'s shape from reading the source — a member has no equivalent way to
self-verify the number from the brief alone. Flagged as a minor enhancement idea in the journal
two cycles ago; small and unambiguous enough on a second look to ship directly under the standing
CARVE-OUT rather than leave it as a permanent TODO.

### Fix

`pnlSection` (`play-brief.ts`) now appends a `Banked:` line whenever the blended composite is
shown, naming every fired `trim_levels` rung's fraction, trigger, and (when the ladder priced
one) its absolute premium level:

```
Blended P&L (realized trim + open runner): +51.2%
Banked: 50% @ +100% ($33.30)
```

Multiple fired tranches join with ` · `. When a rung fired but carries no priced `premium`
(`TerminalExitTranche.premium` is `null` only when the row had no entry basis to price the level
off — `terminal-ladder.ts`'s own documented contract), the line still shows the known
fraction/trigger and never fabricates a dollar figure it doesn't have.

### Blast radius

Single function, single file (`play-brief.ts`'s `pnlSection`) — purely additive display logic
reading data (`trim_levels[].premium`) already attached to `play.exitPolicy`, no new fetch, no
schema change. Only renders when `blendedPnlPct` already returns non-null (i.e. only on rows that
already show the Blended P&L line), so it cannot appear anywhere the blended line didn't already.

### Fix rationale

Considered reconstructing a fill price instead of using the ladder's own `premium` — rejected:
`premium` is the exact mechanical level `buildTerminalExitLadder` arms `fired` against
(`terminal-ladder.ts`'s own comment), the same value `blendedPnlPct` itself already uses as the
banked-gain proxy two lines above. Reusing it keeps the new line and the number it explains
built from the same source of truth instead of two independently-computed figures that could
drift apart.

### Evidence of testing

- New tests in `play-brief.test.ts`: extended the existing live-CRWD-repro blended-P&L test to
  also assert the new `Banked: **50% @ +100%** ($33.30)` line; added a multi-tranche case (two
  fired rungs, joined with ` · `); added a null-premium case (fired rung with no priced level —
  asserts the fraction/trigger still show and no `($...)` is fabricated).
- RED confirmed: reverting the `pnlSection` change alone (git stash of just the source edit)
  reproduced exactly 3 failing tests (the extended CRWD assertion + the two new tests); 53/56
  still passed, confirming the failures were isolated to the new behavior.
- GREEN: fix restored, 56/56 `play-brief.test.ts` pass.
- Full `src/lib/swing/*.test.ts`: 1084/1084 pass.
- Full `npm test` (Node 20, `--experimental-test-module-mocks`): 14099/14099 pass, 0 fail, 3 skip
  (pre-existing skips, unrelated).
- `npx tsc --noEmit`: clean.

Found and shipped during the Night Hawk Swings standing aggressive-mode mandate (operator
directive: hunt for genuine enhancement opportunities every cycle, not just bugs) — a small,
self-contained, purely-additive product-legibility improvement to Ask Largo's swing play-brief,
no cross-desk sign-off needed under the standing CARVE-OUT discipline.
