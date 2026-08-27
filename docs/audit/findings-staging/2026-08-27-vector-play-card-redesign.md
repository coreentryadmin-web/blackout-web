> **kind:** FINDING

## Vector Suggested Play card redesigned — bigger, clearer hierarchy (operator UI request) — FIXED

| **Status** | FIXED in `fix/vector-alerts-icon-and-play-card` |
| **Severity** | P3 — desk UX (operator-requested, not a defect) |
| **Surface** | `/vector` standalone page, `VectorPlayCard` in the action rail |

### Ask (verbatim, operator, 2026-08-27)

> "I feel like the layout UI UX of Vector plays is really bad — like really bad — and it is small,
> can we make it bigger??"

### What changed

Presentation-only redesign of `src/features/vector/components/VectorPlayCard.tsx`. No field was
added or removed and `src/features/vector/lib/vector-play-engine.ts` (`buildVectorPlay`, the
conviction/grade math, everything that decides WHAT the play is) is completely untouched — every
value rendered (`style`, `bias`, `conviction`, `grade`, `headline`, `thesis`, `entryZone`,
`targets`, `invalidation`, `dataAge`/STALE) was already on `VectorPlay` before this change.

### Design decisions

- **Grade + conviction fused into one verdict badge.** Before: a 20px letter chip and a
  right-floated bare "76%" text were two disconnected scraps a member had to piece together.
  After: one pill badge reading "A · 76%", colored by grade (emerald/amber/neutral), borrowing the
  color-coded pill-badge idea from SPX Slayer's `SpxPlayVerdictBar`
  (`src/features/spx/components/SpxPlayVerdictBar.tsx`) — its mode badge is exactly this pattern
  (border+background+text in one tone) for a sibling product's "verdict at a glance" concept.
  Structure was NOT copied 1:1 — SPX's bar is a collapsible header+body dialog with inline styles;
  Vector's card stays a single static block using the repo's existing Tailwind `@apply` convention
  in `globals.css`, since that's the format that fits how this card is already consumed (always
  visible in the action rail, no expand/collapse need).
- **Headline promoted to the card's most prominent element.** Before: headline and thesis were
  visually almost the same weight (14px semibold vs 13px). After: headline is 17px bold, thesis
  stays a secondary 13.5px — the one-line trade idea now reads first, matching "headline/thesis
  most prominent" from the design brief.
- **Entry/Targets/Invalidation stayed a `<dl>`** (it already was, not run-on prose) but gained a
  left accent rule per row plus directional coloring: Targets green (favorable exit), Invalidation
  rose/red (the stop) — so "where do I get out" is scannable without reading the sentence.
- **Overall size increased**: `rounded-xl`→`rounded-2xl`, `px-3 py-2.5`→`px-4 py-3.5`, more
  breathing room in the levels grid (`gap-0.5`→`gap-2`, `pt-1.5`→`pt-3`) — so the card reads as a
  primary rail element rather than a cramped sidebar afterthought, per the literal "make it
  bigger" ask, without simply scaling font-size uniformly (which the task brief explicitly warned
  against as too literal a fix).
- **Left deliberately unchanged**: the `starred` field on `VectorPlay` (the "watch this now" list
  used internally by `vector-play-candidates.ts` for contract-pick ranking) is not surfaced here.
  It isn't rendered by any current UI and adding a new information surface wasn't part of either
  the operator's ask or the presentation-only scope of this PR — flagging it here as something a
  future design pass could consider, not doing it opportunistically now.

### Blast radius

- `src/features/vector/components/VectorPlayCard.tsx` — markup + doc comment only.
- `src/app/globals.css` — `.vector-play-card*` rule block only; no other component uses these
  classes (`grep -rn "vector-play-card-grade\|vector-play-card-conviction" src` returns nothing
  after the rename, confirming no stale references).
- `vector-play-engine.ts`, `vector-play-candidates.ts`, and every other consumer of `VectorPlay`
  are untouched.

### Evidence

- `npx tsc --noEmit` clean.
- New `VectorPlayCard.test.ts` (5 assertions: every pre-existing `VectorPlay` field still read,
  grade+conviction fused into one badge element, the levels stay a structured `<dl>`, the CSS
  padding/radius/headline-size actually grew rather than just relabeling classes, and
  targets/invalidation are color-coded) — all pass on Node 20.
- Full `src/features/vector` test sweep: 1208/1215 pass, the 7 failures pre-existing/unrelated
  (see the companion Alerts finding in this same PR wave for the list — none touch
  `VectorPlayCard` or `vector-play-engine`).
- Live before/after screenshots were not captured for the same reason noted in the companion
  Alerts finding: no pre-prod render target exists since the 2026-07-25 staging decommission, and
  `proxy-browser.cjs` can only reach the deployed production site, not this unmerged branch.
