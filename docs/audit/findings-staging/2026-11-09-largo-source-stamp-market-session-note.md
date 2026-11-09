# BieProvenance.market_session_note reaches every GEX/Vector level and evidence item but SourceStamp never rendered it

> **kind:** `FINDING`

## Status

FIXED

## Root cause

`BieProvenance` (`src/lib/bie/answer-envelope.ts`) carries `market_session_note` — the "compute is
fresh but the market is CLOSED" disclosure, added specifically so a snapshot-based read (GEX
matrix, Vector full-state) that genuinely computes a fresh number off a closed market's last tape
doesn't read as unqualified "live." `src/lib/swing/play-brief.ts`'s `levelsFromContext()` and
`evidenceFromContext()` populate it on nearly every GEX/Vector-derived `BieLevel`/`BieEvidence`
provenance object (call wall, put wall, gamma flip, spot, confluence zones, dark pool, gamma
magnet, GEX king, max pain, and several evidence facts) — a real computation
(`gexMarketSessionNote`/`vec?.market_session_note`), not a placeholder. It flows unchanged through
`composeSwingPlayBrief` to `envelope.levels`/`envelope.evidence` and the API route's `roundFloats`
(which only rounds numeric leaves, never drops string fields) to the JSON response.

`SourceStamp` (`src/features/largo/answer/BieChips.tsx`) is the ONLY renderer of `BieProvenance`,
shared by `BieKeyLevelsTable.tsx`, `BieEvidencePanel.tsx`, and `BieSectionCard.tsx` — all three pass
it `provenance` and nothing else. It destructured only `provenance.source`,
`provenance.freshness`, and `provenance.asOf`; `provenance.market_session_note` was never read
anywhere in the component. The disclosure, despite reaching the wire and having a dedicated,
already-shared UI surface, never reached a member's screen: a snapshot computed off a closed
market's last tape showed only a plain "Live" freshness badge with no caveat — exactly the
misleading-presentation failure mode this field exists to prevent.

## Evidence (RED → GREEN)

New test file `src/features/largo/answer/BieChips.test.ts` (no prior test file existed for this
component), using the repo's existing `renderToStaticMarkup` component-test pattern:

- `market_session_note` renders when present, additive to the existing freshness/source output —
  RED (confirmed by stashing just `BieChips.tsx`): note text absent from render; GREEN: present
  alongside the unchanged freshness badge.
- Two regression guards: absent / explicitly-`null` `market_session_note` renders nothing extra
  (no empty caveat line, preserving the Largo C6 omission-not-fabrication contract).

Pre-fix: 1 of 3 new tests fail. Post-fix: 3/3. `npx tsc --noEmit` clean.

## Blast radius

`SourceStamp` is shared by three consumers (`BieKeyLevelsTable`, `BieEvidencePanel`,
`BieSectionCard`) — all three benefit automatically since none of them pass or read
`market_session_note` themselves; they only forward `provenance` to `SourceStamp` unchanged.
Wrapped the existing inline source row in a new `bie-source-wrap` column container so the note
(a full sentence, not a short chip label) renders on its own line below the existing nowrap
source/freshness/time row, rather than cramming it into that row. No existing CSS selector
targeted `.bie-source` as a direct child of anything, so the new wrapper introduces no breakage.

## Fix rationale

Additive only — the existing freshness/asOf rendering is completely untouched; the note is a new
sibling line, never a replacement, matching the field's own doc comment ("ADDITIVE, orthogonal to
freshness"). Styled in the same amber/warning tone as `.bie-fresh-stale` since it is a caveat, not
a routine freshness label.
