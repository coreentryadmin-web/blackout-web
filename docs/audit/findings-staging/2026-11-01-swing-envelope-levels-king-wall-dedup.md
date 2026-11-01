## Ask Largo swing play-brief `envelope.levels` restated a GEX-king/wall (and confluence/max-pain) price collision twice under two labels in the "Key levels" footer — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | MEDIUM (Ask Largo × Night Hawk Swings standing ownership mandate — "narrative-vs-bullet-dump quality"; not a wrong number, but the SAME real number stated twice under two labels, in both the raw `envelope.levels[]` JSON array and the generic "**Key levels:**" markdown footer every Largo product shares) |
| **Surface** | `levelsFromContext()` in `src/lib/swing/play-brief.ts` (the source of `envelope.levels`), consumed directly by `GET /api/market/swing/play-brief`'s JSON response and by `renderLevels()` in `src/lib/bie/answer-envelope.ts` (the shared markdown renderer every `BieAnswerEnvelope`-based product uses) |
| **Status** | FIXED |

### Root cause

`levelsFromContext()` resolves 9 level kinds — flag anchor/entry trigger (WATCH only), call wall,
put wall, gamma flip, spot, confluence zones, dark pool, gamma magnet, GEX king, max pain — **fully
independently of one another**, pushing each one that resolves non-null as its own `BieLevel` into
the `levels` array with zero cross-check for price collisions between any of them, before
`return levels.slice(0, 10)`.

A GEX king strike is definitionally wherever gamma concentration peaks, so it commonly coincides
with a wall; a confluence zone commonly coincides with max pain (one of its own named co-located
inputs). Either coincidence produces two `envelope.levels` entries at the identical price under two
different labels.

This is the **third** sibling of a bug class `docs/audit/FINDINGS.md` already fixed TWICE at other
call sites:
- `collectFocalLevels` (`play-brief-narrative.ts`, PR #7000, 2026-10-31) deduped the same collision
  for the structure-ladder's rungs and the narration bullets.
- `extractEvidence()` (`play-brief-adapter.ts`, same date) deduped the same collision for the
  Largo-contract-facing `evidence_numbers` field.

Both of those write-ups explicitly scoped their dedup to their OWN call site and named
`levelsFromContext`'s own output array (`envelope.levels`) as **"a separate,
independently-computed list ... out of scope here, unaffected either way."** That deferred gap is
exactly what reaches `renderLevels()`'s "**Key levels:**" markdown bullet list (rendered under
"## Hold plan") and the raw structured `envelope.levels[]` JSON field verbatim — neither of the two
prior fixes touches this array.

### Evidence

Live reproduction (2026-11-01, production, read-only, `GET /api/market/swing/play-brief`), 3 fresh
SWING-lane committed tickers not checked in either prior pass (CC/KTOS/VKTX, vs META/MRNA for the
`evidence_numbers` fix and META/CC/TSM for the `collectFocalLevels` fix):

- **CC** (`SWING:CC:2320`): `envelope.levels` contained both `{label:"call wall", price:15}` and
  `{label:"GEX king", price:15}`. The "**Key levels:**" markdown listed both `"- call wall: 15.00"`
  and `"- GEX king: 15.00"`.
- **KTOS** (`SWING:KTOS:2291`): same shape, `{label:"call wall", price:43}` and
  `{label:"GEX king", price:43}`.
- **VKTX** (`SWING:VKTX:2298`): TWO independent collisions in one response —
  `{label:"call wall", price:30}` / `{label:"GEX king", price:30}`, AND
  `{label:"confluence (call-wall@27.5+max-pain)", price:27.5}` /
  `{label:"max pain", price:27.5}` (the confluence label itself already names max pain as a
  co-located input, yet max pain was still pushed as a separate entry at the same price).

Contrast confirmed the two prior fixes are both still working correctly live and this is a genuinely
distinct, still-open call site: the same CC response's narration bullets and `evidence_numbers`
correctly show only ONE "Call wall 15.00" bullet and only one "call wall: $15.00" evidence line —
no duplicate "GEX king" anywhere in either.

RED→GREEN, reverting just the fix in `src/lib/swing/play-brief.ts` (`pushLevel` back to a bare
`levels.push`), keeping the new tests in place:

- **Before the fix**: a hand-built Vector fixture with a call wall and a GEX king at the identical
  strike (15) produces two `envelope.levels` entries at 15.00 (`call wall` and `GEX king`); a
  second fixture with a confluence zone and max pain both at 27.50 produces two entries at 27.50
  (`confluence (...)` and `max pain`) — reproducing the exact live CC/KTOS/VKTX shape.
- **After the fix**: exactly one entry survives per colliding price in both cases — the
  first-pushed label wins (`call wall` over `GEX king`; `confluence (...)` over `max pain`), per
  `levelsFromContext`'s own existing push order.

`src/lib/swing/play-brief.test.ts`: full suite passes, including the 2 new regression tests.
`npx tsc --noEmit` clean repo-wide on Node 20.

### Blast radius

1. `envelope.levels[]` is served verbatim in the JSON response of `GET /api/market/swing/play-brief`
   — any API consumer reading the structured field directly (a "show on chart" follow-up, another
   Largo tool, or Largo's own answer-engine context if it ever reads `envelope.levels` instead of
   or in addition to `evidence_numbers`) saw the duplicate price under two labels.
2. `renderLevels()` (`src/lib/bie/answer-envelope.ts`) is the SHARED, generic markdown renderer for
   `envelope.levels` used by every `BieAnswerEnvelope`-based product (0DTE, SPX, Vector, Helix,
   Legacy, Meridian, Swing), not swing-specific — so any other product's level-building function
   that independently resolves an analogous collision into its own `envelope.levels` would surface
   identically through this same renderer. Not independently verified live on other products in
   this pass — flagged as a shared-code-path risk, not a confirmed cross-product repro. The fix
   here is at swing's own `levelsFromContext()`, the one call site this finding reproduced; a
   future pass auditing another product's level-builder should check for the same gap rather than
   assuming this fix covers it.
3. Within swing, every caller of `levelsFromContext` (`play-brief.ts`'s own `safeCompose("levels",
   ...)` feeding `composeSwingPlayBrief`) is affected — every OPEN/WATCH/CLOSED swing play-brief
   response whose GEX king strike or confluence node happens to coincide with a wall or max pain.

**NOT affected** (reconfirmed live, same pass): the narration bullets ("Trade manager read"),
`structureLadder.rungs`, and `evidence_numbers` — all three already correctly deduped by the two
prior fixes. The dedicated "Levels on chart" section (`chartLevelsSection`, `play-brief-intel.ts`)
is a deliberately comprehensive chart-overlay listing, not a citation footer, so showing call wall
and GEX king as separate explicit fields there is intentional and out of scope for this finding.

### Fix rationale

Added a `pushLevel(levels, level)` helper right above `levelsFromContext()` and routed every one of
the function's 11 `levels.push({...})` call sites through it. It checks for an existing entry
within a cent (the same `< 0.01` price-identity tolerance this product already uses elsewhere for
the identical purpose — `confluenceZoneKindsLabel`, `play-brief-absence.ts`; `pushFocalLevel`,
`play-brief-narrative.ts`) and, on a collision, keeps the first-pushed entry rather than pushing a
second one.

Fixed at the actual source (`levelsFromContext` itself) rather than deferred a third time, so every
reader of `envelope.levels` — the generic shared renderer, the raw JSON field, and any future call
site — benefits, not just a third narrow per-consumer patch. Keeping the FIRST-pushed entry needs
no hard/soft kind-precedence logic (unlike `pushFocalLevel`'s neutral-pivot-vs-structural-wall
tiering): the function's own fixed push order already puts call wall/put wall/gamma flip before GEX
king, and confluence zones before max pain, which naturally reproduces the same "wall wins over
king" / "confluence wins over max pain" display convention the two prior fixes already established
— verified against this file's own live evidence rather than assumed.

Deliberately left unchanged: the watch-only flag-anchor/entry-trigger levels are pushed through the
same helper for consistency (the root cause names "zero cross-check... between any of them," not
just the GEX/Vector-sourced subset), but no fixture in this pass exercised a collision on that pair
specifically — the fix is uniform across the whole array rather than special-cased to the two
reproduced collision shapes.

### Tests

`src/lib/swing/play-brief.test.ts` — 2 new tests:
1. `"composeSwingPlayBrief: a GEX king coinciding with a call wall merges into ONE envelope level,
   not two (2026-11-01, live repro CC/KTOS)"`.
2. `"composeSwingPlayBrief: a confluence zone coinciding with max pain merges into ONE envelope
   level, not two (2026-11-01, live repro VKTX)"`.

Both proven RED (fail against the pre-fix `levels.push`) then GREEN (pass with `pushLevel`) via a
git-stash-equivalent revert of just the source fix.
