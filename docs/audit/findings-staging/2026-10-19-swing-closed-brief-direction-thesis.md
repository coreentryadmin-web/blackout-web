## 2026-10-19 — [FINDING, swing] `composeSwingPlayBrief` never populated `envelope.direction`/`envelope.thesis` — Largo C5/C8 gap, every bucket (not just CLOSED)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (WATCH — fallbacks present: `bias`, `headline`; field-completeness, not correctness) |
| **Surface** | `src/lib/swing/play-brief.ts` — `composeSwingPlayBrief()`; `src/lib/bie/answer-envelope.ts` — `BieAnswerEnvelope` type |

### Builds on

`docs/audit/findings-staging/2026-10-18-closed-brief-direction-thesis.md` (sibling audit lane,
branch `audit/largo-swing-brief-contract-validator`) — that finding did the live repro (3 real
CLOSED chains: NVDA, CRWV, TSLA, all missing `envelope.direction`/`envelope.thesis`) and the root-
cause trace to `composeSwingPlayBrief`. This PR implements the fix it left open, plus one
correction found while implementing it (see "Scope correction" below). That finding's own file is
left untouched on its branch — this is an independent branch off `main`.

### Symptom (per the original finding)

`GET /api/market/swing/play-brief` on CLOSED swing positions returned envelopes with `bias`
correctly set and `headline` naming the direction/recommendation in prose, but `envelope.direction`
and `envelope.thesis` were undefined — a Largo C5 (DIRECTION) / C8 (NARRATIVE) violation. Vector,
0DTE, and Helix briefs populate explicit `direction`/`thesis` at their own payload's top level;
swing's `envelope` carried neither field.

### Scope correction (found while implementing)

The original finding scoped this to CLOSED chains (all 3 live repros tested were CLOSED). Reading
`BieAnswerEnvelope` (`src/lib/bie/answer-envelope.ts`) before implementing showed the gap is **not**
CLOSED-specific: the type itself never declared a `direction` or top-level `thesis` field for ANY
producer, and `composeSwingPlayBrief`'s envelope-literal (`buildRichEnvelope({...bias: ...})` plus
the explicit `source`/`asOf`/`session_date`/`structureLadder` fields added alongside it) never set
either field on any of its three branches — WATCH, OPEN, or CLOSED. Confirmed with a regression
test covering all three buckets (not just CLOSED) before writing the fix; all three failed RED
identically. Fixed consistently across all three rather than CLOSED-only, per the task's own
"if missing for ALL statuses, fix all of them consistently" guidance.

### Root cause

`BieAnswerEnvelope` (the shared envelope type every BIE-narrative composer across the app returns)
only ever carried `bias` (normalized bullish/bearish/neutral/mixed) — no native per-product
`direction` field, and no top-level single-sentence `thesis` claim (only per-`BieSection`/
per-scenario text). `composeSwingPlayBrief` built its envelope via `buildRichEnvelope({ bias:
biasFromDirection(play.direction), ... })`, which derives the *normalized* `bias` from
`play.direction` but never forwards the *native* `play.direction` value itself, and never
synthesized a `thesis` claim at all — there was no field defined for either to land in.

### Fix

1. **`src/lib/bie/answer-envelope.ts`** — added two new, additive, optional fields to
   `BieAnswerEnvelope`:
   - `direction?: string | null` — the native per-product directional label (Largo C5), kept as a
     free-form string (not constrained to `product-read.ts`'s own `Direction` union) so each
     product's own vocabulary (swing's "LONG"/"SHORT") is never force-fit into a narrower enum —
     matching the contract's own "wrap, never flatten" rule.
   - `thesis?: string | null` — one normalized single-sentence claim (Largo C8), distinct from the
     full per-section prose and from the backward-compatible `markdown` string.

   Both optional and additive — no existing composer or consumer is affected; `tsc --noEmit` is
   clean repo-wide.

2. **`src/lib/swing/play-brief.ts`** — `composeSwingPlayBrief` now sets:
   - `direction: play.direction` — the exact same source `bias` already derives from
     (`biasFromDirection(play.direction)`), carried through as the raw label instead of only the
     normalized read. Mechanical, no design decision.
   - `thesis: briefThesis(play, headline, action, verdictArchetypeLabel)` — a new small pure
     helper. Design choice (of the three the task offered, in preference order): **option (a)** —
     reuse an already-computed one-line summary rather than invent new logic. `briefThesis` builds
     its sentence from the exact same inputs the Verdict section's own opening line
     (`verdictLines[0]`) and the envelope `headline` already use: `play.direction`, the contract
     headline (`playContractHeadline(play)`), and the identical
     `action?.label ?? play.recommendation ?? play.status` fallback chain both of those already
     apply — plus the archetype label when present. `thesis` can therefore never state a claim the
     Verdict card or headline doesn't already make, and for a CLOSED play with a resolvable
     `closedReason`, `swingActionDisplay` already turns that into "TARGET"/"STOPPED"/"SCRATCH" (the
     same label the Verdict line and headline show), so the synthesized thesis is genuinely
     data-grounded — e.g. `"SHORT NVDA 90C · 13DTE — STOPPED · Breakout."` — never a fabricated
     claim about why a position closed.

   Options (b)/(c) from the task were not needed: the Verdict line's own components already
   satisfied option (a)'s bar for every bucket, including CLOSED.

### Evidence

Two regression tests added to `src/lib/swing/play-brief.test.ts`:
- `composeSwingPlayBrief: CLOSED play envelope carries explicit direction and thesis fields (Largo
  C5/C8)` — fixture with `direction: "SHORT"`, `closedReason: "stopped"`, asserts
  `envelope.direction === play.direction` and `envelope.thesis` is a non-empty string containing
  the direction, ticker, and the closedReason-driven "STOPPED" label.
- `composeSwingPlayBrief: OPEN and WATCH briefs also carry explicit direction/thesis (not
  CLOSED-specific)` — covers the scope correction above.

Proved RED before the fix (reverted only `play-brief.ts` via a saved patch, kept the type change and
the tests, reapplied after) and GREEN after, on Node 20 (`/opt/node20/bin`, v20.20.2):

RED (fix reverted):
```
not ok 11 - composeSwingPlayBrief: CLOSED play envelope carries explicit direction and thesis fields (Largo C5/C8)
    expected: 'SHORT'  actual: undefined
not ok 12 - composeSwingPlayBrief: OPEN and WATCH briefs also carry explicit direction/thesis (not CLOSED-specific)
    expected: 'LONG'  actual: undefined
```

GREEN (fix reapplied), full file plus four sibling swing play-brief test files plus
`answer-envelope.test.ts`:
```
# tests 634
# suites 5
# pass 634
# fail 0
```

`npx tsc --noEmit` clean on Node 20 (repo-wide — confirms the two new optional `BieAnswerEnvelope`
fields don't break any other composer/consumer).

### Blast radius

- `BieAnswerEnvelope` is shared by every BIE-narrative composer (Helix/Thermal/Vector/Meridian/
  Night Hawk/SPX/concept answers), but both new fields are optional and additive — no other
  composer sets them, so no other envelope's shape changes. `tsc --noEmit` confirms no call site
  broke.
- `src/lib/swing/play-brief-adapter.ts`'s `adaptSwingBriefToLargo` (which already derives a
  *normalized* `direction` from `envelope.bias` for the route's top-level Largo contract fields)
  is untouched — it answers a different question (normalized bullish/bearish/neutral for
  cross-product joins) from the native `envelope.direction` this fix adds. Both coexist; no
  conflict, no behavior change to the existing top-level `direction`/`evidence_numbers` fields the
  route already serves.
- Only `composeSwingPlayBrief` was changed in `play-brief.ts`; no other swing composer (narrative,
  narrative-coaching, intel, diff) builds an envelope independently of this function.

### Fix rationale

Adding the fields to the shared `BieAnswerEnvelope` type (rather than a swing-only wrapper type)
matches how every other Largo-contract field already on this type was added (`ticker_class`,
`session_date`, `source`) — additive, optional, documented inline with its Largo-C citation — so a
future composer gets the same fields for free instead of re-inventing a parallel, swing-specific
shape. Deliberately left unchanged: `play-brief-adapter.ts`'s existing normalized-direction
derivation, the top-level route response shape, and every non-swing composer (none of them had a
`direction`/`thesis` gap to begin with — only swing's own staged finding raised this).
