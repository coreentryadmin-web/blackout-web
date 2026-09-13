> **kind:** FINDING

## Ask Largo swing WATCH brief could surface a raw pillar-score fallback ("Discovery read: regime 0.33") with no archetype context — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`serving-ingest.ts`'s `swingServingMetaFromDossier` composes the "regime" display field by blending
the classified archetype label with the normalized REGIME pillar score:

```ts
const regime = archetypeLabel
  ? regimePart
    ? `${archetypeLabel} · ${regimePart}`
    : archetypeLabel
  : regimePart;
```

`classifyArchetype` has a deliberate, honest null-when-thin design (EVIDENCE_FLOOR) — a name with no
grounded archetype-fit inputs gets `archetype: null` rather than a fabricated label. Several real WATCH
candidates (BE, MU, AMD, all noted in earlier audit cycles) hit this path. When `archetypeLabel` is
null, the ternary above falls all the way through to the bare `regimePart` alone — a raw 0-1 pillar fit
score formatted as `regime ${value.toFixed(2)}`, with no context.

`play-brief-intel.ts`'s `whyThisSetupSection` pushes this field verbatim into the live narrative:

```ts
if (play.regime) lines.push(`**Discovery read:** ${play.regime}`);
```

### Live repro

`GET /api/market/swing/play-brief?playId=SWING:BE` (2026-09-13, real WATCH candidate) — the "Why this
setup" section read:

```
**Signals fired:** BANGER · FLOW · STRUCTURE
**Sub-lane:** STANDARD
**Discovery read:** regime 0.33
**Industry read:** leading Technology (XLK) by 27.1% over 10 sessions...
**Score pillars:**
• Regime — +4.8 pts
• Flow — +2.9 pts
```

"Discovery read: regime 0.33" is a raw, unlabeled fallback string — the same 0-1 fit number already
shown, correctly labeled, two lines below under "Score pillars: Regime". A real member reading this
brief has no way to know "regime 0.33" means anything; it reads as leaked internal state, not a
trader-facing explanation.

This is the same bug class as the committed-row (`OPEN`/`CLOSED`) twin of this field, which was already
found live (NRG, `SWING:NRG:34`) and fixed on 2026-09-07 in `live-plays.ts` — that fix explicitly chose
honest omission (`null`) over any synthesized value, with an extensive comment explaining why. This
WATCH-lane sibling call site (`serving-ingest.ts`, consumed by `serving-lane.ts`'s `enrichPlay`) was
never patched — the exact "duplicated logic in a second file" case CLAUDE.md's PR write-up policy
calls out as blast radius, just discovered later rather than in the same pass.

### Fix

`swingServingMetaFromDossier` now returns `regime: null` whenever `archetypeLabel` is null, instead of
falling back to the bare `regimePart` string. The combined case (`archetypeLabel` present) is
unchanged — `"<Archetype> · regime N.NN"` still renders exactly as before, matching the existing test
(`serving-ingest.test.ts`'s "regime blends the archetype label with the normalized regime pillar").

### Blast radius

Single function (`swingServingMetaFromDossier`, `serving-ingest.ts`). Consumers (`serving-lane.ts`'s
`enrichPlay`/second call site, `legacy-confirm-promote.ts`) all already null-check `meta.regime`
defensively (`meta.regime == null` / `meta.regime ?? play.regime`), so the change flows through safely
with no further edits needed at those call sites. Does not touch the already-fixed committed-row path
(`live-plays.ts`).

### Fix rationale

Considered instead giving the bare pillar score its own distinct, honestly-labeled line (e.g.
"Regime pillar: 0.33") — rejected: the exact same number is already shown, labeled, under "Score
pillars: Regime — +N pts" two lines later in the same section, so a second rendering would be pure
duplication, not new information. Honest omission matches the precedent already set for this field's
committed-row twin and adds no new field for the reader to parse.

### Evidence of testing

- New test in `serving-ingest.test.ts`: constructs a dossier with a genuinely neutral `SwingReads`
  (no accumulation, no EMA stack — every archetype-fit input null, matching the live BE/MU/AMD shape)
  plus a real `regime01`, and asserts `archetypeLabel === null` and `regime === null`.
- RED confirmed: reverting only the source fix (keeping the new test) reproduced the exact live bug —
  `meta.regime` was `"regime 0.33"` instead of `null`.
- GREEN: fix restored, all 11 tests in `serving-ingest.test.ts` pass (10 pre-existing + 1 new).
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): see PR for final count.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, live BE
WATCH-bucket play-brief pull, 2026-09-13. Single instance (not corroborated across multiple tickers
before shipping) — but the root cause (`archetypeLabel: null`) is a documented, already-live condition
affecting several real WATCH tickers (BE/MU/AMD), and the fix is a narrow, swing-lane-local honest-omission
change with a directly analogous, already-shipped precedent (`live-plays.ts`, 2026-09-07) — no cross-desk
sign-off needed under the standing CARVE-OUT discipline.
