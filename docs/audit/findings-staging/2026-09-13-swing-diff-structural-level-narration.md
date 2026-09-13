> **kind:** FINDING

## Ask Largo's live "what changed" diff still read GEX walls/mark as bare `$X → $Y` deltas — feat/swing-diff-structural-level-narration — 2026-09-13

- **What was broken:** `diffBriefSnapshots` (`src/lib/swing/play-brief-diff.ts`) already got a
  cross-field synthesis pass for thesis/spot/P&L/recommendation shifts (PR #4682, 2026-09-09) —
  connecting co-occurring facts into one trade-manager-voice line instead of disconnected
  bullets. But four fields never got that treatment and still emitted bare numeric deltas: option
  mark (`Option mark $5.90 → $6.18`), gamma flip, call wall, and put wall (`Call wall 110 → 113
  (+3.0)`). A member reading the live refresh pulse had to do their own arithmetic to know whether
  a wall moving mattered — the same bullet-dump-vs-trade-manager-voice anti-pattern #4084 and
  #4682 already fixed elsewhere in this exact file, just not swept to every field.
- **Why it wasn't caught earlier:** #4682's own PR description scoped itself to the specific
  co-occurring-shift patterns it had live evidence for (thesis+price, P&L+upgrade) — it never
  claimed to cover every field, and nothing flagged the four leftover bare-delta lines as a gap
  until this session's Ask Largo "keep digging" pass read the file end-to-end against the
  standing mandate's own wording ("narrating the live 'what changed' diff the same trade-manager
  way instead of numeric deltas") rather than assuming #4682 closed the whole item.
- **Fix:**
  - `narrateMarkShift(prev, next)` — reuses the same "built"/"slipped" tone vocabulary as
    `narratePnlShift` for the option's own dollar price, e.g. `**Option mark built** — $5.90 →
    $6.18 (+0.28)`.
  - `narrateStructuralLevelShift(label, prev, next, prevSpot, nextSpot)` — for gamma flip/call
    wall/put wall, reframes the level's own drift as room-to-spot compressing or receding (using
    each snapshot's OWN contemporaneous spot, not a mixed-instant comparison), e.g. `**Call wall
    closing in** — $110.00 → $104.00, now $4.00 away (was $10.00) — less room before it matters`.
    Falls back to the old plain delta line in two honest cases: spot is unavailable on either
    side, or the room-to-spot genuinely didn't change (spot drifted by the same amount as the
    level, so the cushion is unchanged even though the raw number moved) — never fabricates a
    "closing in"/"receding" read when the underlying room fact doesn't actually support it.
- **Fix rationale:** deliberately did NOT judge the wall's move as favorable/adverse by direction
  the way `adverseSpotDrift` already does for spot itself — a wall's own drift affects a LONG and
  a SHORT reading the same level identically (both care whether the cushion between spot and that
  level compressed or grew), so "less/more room before it matters" is the honest, direction-neutral
  framing; inventing a directional judgment here without live evidence for which reading traders
  actually want would be exactly the kind of unearned certainty the Largo product contract's
  confidence-omission rule warns against. Left `Verdict headline updated` and the `New sections:`
  line as plain meta statements (not price facts) — out of scope for this pass.
- **Blast radius:** single call site (`diffBriefSnapshots`), consumed only by
  `useSwingPlayBrief.ts` as opaque strings (via `envelopeWithNarrativePulse`/
  `envelopeWithDiffSection`) — no other test or component depends on the old exact wording.
- **Evidence:** 6 new tests in `play-brief-diff.test.ts` (mark built/slipped, wall closing-in,
  wall receding, plain-delta fallback when spot is null, plain-delta fallback when room is
  genuinely unchanged). RED→GREEN via `git stash` on `play-brief-diff.ts`: all 6 new assertions
  failed pre-fix (old bare-delta text), passed post-fix. Full suite + `tsc --noEmit` run alongside
  this PR.

| **Status** | Fixed — PR opened, CI pending |
