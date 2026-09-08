## 2026-09-06 — [P2, correctness] Ask Largo swing brief "what changed" diff engine's HELIX flow-shift alert was permanently dead — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Play Intelligence — "Ask Largo" brief (`play-brief-diff.ts`, `useSwingPlayBrief.ts`) |

### Root cause

PR #4068 ("Ask Largo v3 — diff engine, live refresh, follow-up chips") shipped `diffBriefSnapshots`
with a fully-built comparison branch for HELIX call/put flow premiums — `BriefSnapshot` carries
`flowCallPremium`/`flowPutPremium` fields, and the diff logic fires `"HELIX tape: call/put flow
building"` when they move >$50k between polls. But nothing on the client ever populated those two
fields: `useSwingPlayBrief.ts`'s `extrasFromEnvelope()` derived `spot`/`gammaFlip`/`callWall`/
`putWall` by string-matching labels in `envelope.levels` (the only per-poll numeric surface the
hook had), and never touched flow premiums at all — because the server never put them there either
(`levelsFromContext` in `play-brief.ts` only ever builds GEX/spot/confluence `BieLevel` entries).
So every call into `snapshotFromBrief` passed `flowCallPremium: undefined, flowPutPremium:
undefined`, which `fin()` always turns into `null`, so `diffBriefSnapshots`'s
`prev.flowCallPremium != null && next.flowCallPremium != null` guard could never both be true. The
feature shipped, tested (its pure comparison logic has real unit coverage in
`play-brief-diff.test.ts`), and was permanently inert in production — a real HELIX flow build on a
watched ticker would never surface in the "What changed" panel, no matter how large the shift.

### Fix

- Added an explicit typed `flowSnapshot: { callPremium, putPremium } | null` field to
  `SwingPlayBriefResult`/the API response, populated in `composeSwingPlayBrief` straight from
  `ctx.ecosystem.recent_flow` (the same source `flowIntelSection` already reads for the human-
  readable "Flow & positioning" section — no new fetch, no new latency).
- Replaced the hook's inline `extrasFromEnvelope()` with an exported, unit-tested
  `extrasFromBriefResponse()` in `play-brief-diff.ts` (the diff module, its natural home) that reads
  spot/gammaFlip/callWall/putWall from `envelope.levels` as before, and flow premiums from the new
  explicit field — no more silent per-field gaps, since the type signature now forces every diff
  input to have a named source.

### Blast radius

`play-brief.ts`, `play-brief-types.ts`, `play-brief-diff.ts`, `useSwingPlayBrief.ts` only. No other
caller of `composeSwingPlayBrief`/`useSwingPlayBrief` exists. Additive field — no existing consumer
of the API response breaks.

### Evidence

- `play-brief-diff.test.ts`: new `extrasFromBriefResponse` unit tests (levels-by-label +
  flowSnapshot field + a missing-flowSnapshot null-safety case) and an end-to-end test that a
  built HELIX call-flow move now actually reaches `diffBriefSnapshots` and produces a `"HELIX
  tape"` line — this last test is the direct regression proof for the dead-code bug.
- `play-brief.test.ts`: `flowSnapshot` populated from `ecosystem.recent_flow` when present, `null`
  when absent.
- **RED confirmed**: `git stash` the four fix files (types/play-brief.ts/play-brief-diff.ts/hook),
  keep the new tests — 5/10 tests fail (`extrasFromBriefResponse` doesn't exist; `flowSnapshot` is
  `undefined` not `null`). **GREEN post-fix**: 10/10.
- Full suite (Node 20.20.2): swing + hooks + command-deck — **956/956 pass**.
- `tsc --noEmit`: clean.

### Note for Cursor (who built the diff engine in #4068)

Same-root-cause collaboration note, not a criticism — the pure diff logic you wrote was correct
and already tested; the gap was purely in what fed it. Also flagging two follow-on ideas from
reading through the rest of the brief engine while fixing this, in case either is worth a look:

1. **The diff baseline only survives within one open browser tab/session** (`prevSnapRef` is a
   plain React ref, reset to `null` whenever the component remounts — page reload, navigating away
   and back, or even just a long idle GC). The case the "what changed" feature seems built for —
   a member who checked a play at market open, closed their laptop, and reopens Ask Largo at 2pm —
   currently shows zero diff, because there's no persisted "last seen" snapshot to compare against
   across a real gap. Persisting the last snapshot (localStorage keyed by `play.id`, or server-side
   per-member) would let the feature cover its actual best case rather than only "I've had this tab
   open the whole time and refreshed a lot."
2. **Desk consensus is currently NH (Night Hawk) + 0DTE only** (`deskConsensusSection` in
   `play-brief-intel.ts`) — Thermal's positioning read and Meridian's earnings positioning for the
   same ticker aren't cross-checked, even though the whole point of Ask Largo (per
   `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s stated purpose) is answering cross-product questions
   like "does Thermal support this Night Hawk trade?". Might be worth wiring in as a follow-up if
   `EcosystemContext` already carries those reads elsewhere.

No code changes requested for either — just surfacing what I found while in the file, per the
standing collaboration protocol.
