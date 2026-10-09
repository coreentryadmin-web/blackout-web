## 2026-10-09 — [FINDING, largo-swing] "What to watch"'s "Structural support node" hardcoded put wall while the authoritative "Break watch" level (and `envelope.invalidation`) can cite a nearer GEX king or dark-pool print instead — two different numbers for the same play's one real support level — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (not a wrong price in isolation — both numbers are real, live levels — but the SAME envelope states two different "structural support" figures for the SAME play with no indication they're different concepts, which is exactly the kind of self-contradiction that erodes trust in a trade-critical number) |
| **Component** | `src/lib/swing/play-brief-intel.ts` (`watchForSection`'s "Structural support node"/"Structural resistance node" line) |
| **PR** | fix/swing-watch-structural-level-nearest-wall |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, fetching fresh `GET /api/market/swing/play-brief` envelopes against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points for fresh leveraged/inverse-ETP swing tickers (SOXS, KOLD, ETHD, AAOZ, XRPN, TNGX), specifically stress-testing for a sibling instance of the #5725 "invalidation level" bug class per this cycle's own standing instruction. |

### Root cause

On 2026-09-15, `breakTrigger`'s "Break watch" bullet (`play-brief-narrative.ts`, the narrative's
reserved, uncappable invalidation callout — also the source for the headline
`envelope.invalidation` field) was fixed to widen its candidate set from "put wall only" to
"whichever of put wall / dark pool / GEX king sits nearest spot on the correct side"
(`resolveInvalidationFocalLevel`), because the GEX king or a dark-pool print can legitimately sit
closer to spot than the put wall and is the more relevant real risk (live CRWD repro at the time:
"the king sat 8x nearer than the put wall").

`watchForSection`'s own "Structural support node" (LONG) / "Structural resistance node" (SHORT)
line — a separate section of the same envelope, "What to watch" — was never updated to match. It
independently computed `putWall = vecPutWall ?? gexForLevels?.put_wall` (LONG) /
`callWall = vecCallWall ?? gexForLevels?.call_wall` (SHORT) and rendered that unconditionally,
with no awareness that a nearer GEX king (or dark-pool print) exists and that the brief's own
headline invalidation field already prefers it. This is the THIRD time this exact defect class —
"two different precedence rules for one conceptual level" — has shipped in this lane (the
`collectFocalLevels` doc comment already names two prior instances: GEX king strike precedence in
`chartLevelsSection`, and the nearest-wall selection itself); this is a new, previously-uncaught
fourth site.

Live repro, `GET /api/market/swing/play-brief?playId=SWING:TNGX:1611&ticker=TNGX&status=OPEN`
(2026-10-08, ~20:44 ET, real committed BANGER-origin LONG position, spot $22.57): GEX king sat at
$22.00 (-2.5% from spot) while the put wall sat at $20.00 (-11.4% from spot) — the king is
genuinely nearer. `envelope.invalidation` and the "Trade manager read" section's "Break watch"
bullet both correctly read **"Break watch — lose 22.00 on a closing basis → structural support
failed; exit or cut size"** — but the SAME envelope's "What to watch" section read **"Structural
support node: put wall 20.00"**, a different number, for what both sections present as THE one
structural level that matters for this play. A member reading "Break watch" to know the real
invalidation price, then checking "What to watch" for confirmation, would see a different price
with nothing telling them it's a different (less relevant) level.

### Blast radius

Every LONG swing play where the GEX king or a dark-pool print sits nearer spot than the put wall
(or every SHORT play where the king sits nearer than the call wall) renders this mismatch — not a
rare edge case, since GEX king/dark-pool clustering near spot is common (per the 2026-09-15 fix's
own CRWD repro). Checked the five sibling leveraged-ETP tickers pulled the same cycle (SOXS, KOLD,
ETHD, AAOZ, XRPN): all five happened to have put wall as the genuinely nearest level, so only
TNGX exposed the live mismatch this pass — consistent with the bug being real but not universal,
exactly the shape a spot-check across several tickers is meant to surface.

### Fix

`watchForSection` now calls the same `resolveInvalidationFocalLevel(play, collectFocalLevels(ctx,
spot))` selection `breakTrigger` uses (both newly exported from `play-brief-narrative.ts`),
instead of re-deriving its own put-wall/call-wall-only version, and renders whichever level wins
using that level's own label ("put wall", "GEX king", or "dark pool") rather than a hardcoded
"put wall"/"call wall" string. The two sections can no longer independently select different
levels for the same play — same staleness gating as before (both now via `collectFocalLevels`'s
own per-level Vector-stale/GEX-stale guards), no behavior change for the common case where put
wall (or call wall) genuinely is nearest.

### Evidence

New regression test (`src/lib/swing/play-brief-intel.test.ts`, "watchForSection: Structural
support node matches breakTrigger's nearest-level selection, not a hardcoded put wall") — built a
fixture with GEX king nearer than put wall (same shape as the live TNGX repro) and asserted
`watchForSection` and `tradeManagerNarrativeSection` must agree. RED pre-fix: `watchForSection`
returned `"Structural support node: put wall **90.00**"` while the narrative's "Break watch"
correctly cited `97.00`. GREEN post-fix: both sections now cite `97.00`. Full suite: `tsc
--noEmit` clean; `npm test` (Node 20.20.2) 15843/15843 passing, 0 failures.
