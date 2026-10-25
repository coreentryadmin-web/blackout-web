> **kind:** `FINDING`

## Helix — Session pulse bar's "Aggression read" showed a confident bull/bear % split directly contradicting its own "Unreadable" label — FIXED

**Status.** FIXED (PR #6714, merged to `main`).

| Field | Detail |
|---|---|
| **Area** | Helix `/flows` desk — `src/features/helix/components/HelixSessionPulseBar.tsx` |
| **Found by** | Live-UI visual check via `proxy-browser.cjs` against prod `/flows` (mobile viewport, 430×932), DISCOVERY-lane sweep, 2026-10-25 |
| **Severity** | P3 (member-facing UI contradiction, no data corruption) |

### Symptom

Live screenshot of `https://blackouttrades.com/flows`: the Session Pulse widget's "Aggression
read" stat rendered the value **"Unreadable"** with the meta line directly beneath it reading
**"45% bull / 55% bear"** — a precise-looking percentage split sitting right next to a label
that says the read could not be determined.

### Root cause

`directionLabel` (`helix-flow-aggression.ts`) is the single source of truth for the "Aggression
read" label: it returns `"undetermined"` ("Unreadable" in the UI) whenever `undetermined >
readable` (more of the tape's premium has no readable ask-side aggressor data than the combined
bullish+bearish readable total) — a deliberate design choice, documented in that file, so "a
verdict resting on a minority of the premium is not a verdict."

But `HelixSessionPulseBar` computed its own `bullPct` for the meta line independently:

```ts
const readable = pulse.bullishPremium + pulse.bearishPremium;
const bullPct =
  readable > 0 ? Math.round((pulse.bullishPremium / readable) * 100) : null;
```

This only checks whether the READABLE bullish/bearish split is non-empty — it never looks at
`pulse.undeterminedPremium` at all. So whenever the tape had a thin but non-zero readable
minority (e.g. $45K bullish / $55K bearish) alongside a dominant undetermined majority (e.g.
$500K), `directionLabel` correctly called the whole read "Unreadable", while this separate
calculation still produced and displayed a confident "45% bull / 55% bear" for that minority —
directly contradicting the label standing right above it.

### Blast radius

Single consumer: `HelixSessionPulseBar` → `FlowFeed.tsx` (the `/flows` desk's session pulse
widget). No other reader of `bullishPremium`/`bearishPremium` shares this exact display logic.

### Fix

Extracted the decision into a pure, testable `sessionPulseBullPct(pulse)` in
`helix-session-pulse.ts`, gated on `pulse.directionRead === "undetermined"` rather than
recomputing `directionLabel`'s own "undetermined > readable" rule separately — the label and the
percentage now share one source of truth and can never disagree again. Returns `null` (falling
back to the existing "No ask-side data" message) whenever the read is undetermined, for either
reason the underlying rule can produce it: no readable premium at all, or undetermined premium
dominating the readable total.

### Tests

3 new cases in `src/features/helix/lib/helix-session-pulse.test.ts`:
- Undetermined due to a dominant-undetermined tape (the live repro shape) → `sessionPulseBullPct`
  returns `null`.
- A readable mixed split still renders its percentage (no regression on the working case).
- The pre-existing no-readable-premium-at-all case still returns `null`.

RED→GREEN confirmed: source reverted via `git checkout --`, 3/3 new assertions fail; reapplied,
7/7 pass. `npx tsc --noEmit` clean on both touched files.
