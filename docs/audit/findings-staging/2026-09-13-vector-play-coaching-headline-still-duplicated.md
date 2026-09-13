> **kind:** FINDING

## `vectorPlayCoaching` still repeated Vector's headline verbatim after the 2026-09-09 "fix" that claimed to remove it — fix/vector-play-coaching-headline-duplication — 2026-09-13

- **What was broken (found live via the Ask Largo standing deep-dive, real AAPL brief, 2026-09-13):**
  When a swing play's direction conflicts with Vector's own directional read, `crossDeskCoaching`
  (`play-brief-narrative-coaching.ts`) fires a **"Cross-desk friction"** bullet that quotes Vector's
  `headline` verbatim: `conflict("Vector", \`bearish (${vp.headline})\`, "structure")`. Separately,
  `vectorPlayCoaching` (same file) unconditionally pushed `Vector desk: **${vp.headline}**` into its
  own bullet regardless of the `conflictAlreadyNoted` flag passed in — that flag only suppressed the
  trailing "— cross-check Vector thesis vs swing direction" clause. Live output on the real AAPL
  brief today: `**Cross-desk friction** — Vector bearish (POSITION · momentum short on continuation
  → target 1σ 327.77)...` immediately followed later in the same "Trade manager read" section by
  `Vector desk: **POSITION · momentum short on continuation → target 1σ 327.77**` — the identical
  headline text, presented as two separate facts.
- **Why it wasn't caught earlier:** this is the SAME bug FINDINGS 2026-09-09 already documented and
  claimed to fix (live NRG repro) — but that fix's own doc comment asserted the headline was
  "non-duplicative content" in the same paragraph that described `crossDeskCoaching` quoting "this
  exact headline", a direct self-contradiction. The regression test written alongside that fix then
  codified the bug as intended behavior: `vectorPlayCoaching: omits the redundant cross-check clause
  when the conflict was already noted elsewhere, but keeps the headline/invalidation` asserted
  `assert.match(line!, /Fade into wall/)` with `conflictAlreadyNoted=true` — a test that passed
  because it was testing the wrong thing, not because the bug was fixed. Found by re-reading the
  live brief output end-to-end rather than trusting the FINDINGS entry's claim of "fixed."
- **Fix:** `vectorPlayCoaching` now also omits `vp.headline` from its `parts` array when
  `conflictAlreadyNoted` is true — only `invalidation` and `starred level` (content
  `crossDeskCoaching` never surfaces) remain. Added a guard: if suppressing the headline leaves
  `parts` empty, the function returns `null` rather than an empty "Vector desk:" bullet with no
  facts after it.
- **Blast radius:** single function, single call site (`collectCoachingBullets`, same file) — no
  other consumer of `vectorPlayCoaching`'s return value.
- **Fix rationale:** kept `invalidation`/`starred level` unconditional since those are genuinely
  never rendered by `crossDeskCoaching` — only the specific field that IS duplicated (the headline)
  is now conditional. Did not attempt to unify `crossDeskCoaching` and `vectorPlayCoaching` into one
  function in this PR — that's a larger refactor with its own blast radius; the minimal fix closes
  the actual duplication.
- **Evidence:** corrected the stale 2026-09-09 regression test (it asserted the bug as intended
  behavior) and added two new tests: headline dropped + only-headline-content returns `null` when
  already noted, headline kept when NOT already noted. Also corrected the integration-level
  `collectCoachingBullets` test that asserted the same stale expectation. RED→GREEN via `git stash`
  on `play-brief-narrative-coaching.ts`: 2 new/corrected assertions failed pre-fix (headline present
  in output), passed post-fix. Full suite + `tsc --noEmit` run alongside this PR.

| **Status** | Fixed — PR opened, CI pending |
