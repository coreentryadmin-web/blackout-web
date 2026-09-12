> **kind:** FINDING

## `resolveGammaPosture` let Vector's "unknown" regime silence a real, resolved GEX-matrix posture — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`resolveGammaPosture` (`src/lib/swing/play-brief-absence.ts`) is the shared dealer-gamma-posture
resolver for `dealerPostureLine` (the "Trade manager read" folded bullet),
`narrateMaxPain`/`narrateKing`/`narrateMagnet`, and `laneRankCoaching`'s adjacent narrative. Its
stated design: "Live Vector regime always wins" over the GEX-matrix-only fallback. The
implementation checked only `vecPosture != null`:

```ts
const vecPosture = vec?.regime?.posture ?? null;
if (vecPosture != null && !vectorSnapshotStale(vec, readMs, ctx.sessionDate)) return vecPosture;
```

But Vector's own `regime.posture` (`src/features/vector/lib/vector-regime.ts`) is a **four-value**
enum — `"long" | "short" | "transition" | "unknown"` — not the GEX matrix's own two-value
`"long" | "short" | null` (`GammaPosture` in `src/lib/providers/gex-positioning.ts`). The literal
string `"unknown"` is non-null, so it satisfied `vecPosture != null` and was returned directly as
if it were a resolved answer, on equal footing with `"long"`/`"short"` — never falling through to
the GEX-matrix fallback below it, even when that fallback held a perfectly good, live, resolved
`"short"`/`"long"`.

`gexPostureSection` (`play-brief-intel.ts`) reads `gex.gamma_posture` **directly**, bypassing
`resolveGammaPosture` entirely — so it stayed correctly informative regardless of what Vector's own
regime read said.

### Live repro (2026-09-12, CG's own COMMIT brief)

`GET /api/market/swing/play-brief?playId=SWING:CG:25&ticker=CG&positionId=25&status=COMMIT` in the
SAME response:

> **GEX posture**
>
> Gamma posture: dealers **short gamma** — moves can accelerate, respect walls
>
> Net GEX: **-4.3M**

three sections earlier, in the folded "Trade manager read":

> • Spot **42.34** — dealer gamma posture not resolved on this read.

Vector's own regime computation had independently landed on `"unknown"` for CG at that read; the
GEX matrix's own `gamma_posture` field was live and said `"short"`. A member reading top-to-bottom
sees a confident, numeric dealer-posture claim, then three bullets later the same brief says the
system doesn't know — a direct, self-contradicting disclosure on the exact same fact.

### Fix

`resolveGammaPosture` now treats `vecPosture === "unknown"` the same as a null/absent Vector read —
it defers to the GEX-matrix fallback instead of returning `"unknown"` outright:

```ts
if (vecPosture != null && vecPosture !== "unknown" && !vectorSnapshotStale(vec, readMs, ctx.sessionDate)) {
  return vecPosture;
}
```

`"transition"` is left untouched — it is a real, computed Vector state (dealers near the gamma
flip), and every downstream ternary (`dealerPostureLine`, `narrateMaxPain`, `narrateKing`,
`narrateMagnet`) already degrades it gracefully into their existing "not a settled long/short call"
narrative branch, which is a reasonable reading of a genuine transition state — only `"unknown"`
(Vector has nothing to say) was being mistaken for a resolved answer.

### Blast radius

Every consumer of `resolveGammaPosture` — `dealerPostureLine`, `narrateMaxPain`, `narrateKing`,
`narrateMagnet` (`play-brief-narrative.ts`), and `laneRankCoaching`'s adjacent read
(`play-brief-narrative-coaching.ts`) — is fixed by the one change, since they all call through this
shared resolver rather than re-deriving posture themselves. `gexPostureSection` was never wrong
(it reads the raw field directly) and is unchanged.

### Fix rationale

Same centralization discipline as this session's other self-reference/precedence fixes
(`computeLaneRank`'s self-named-leader, `optionMarkGenuinelyUnknown`): fix once at the shared
resolver rather than adding a per-call-site `!== "unknown"` guard at every narration function that
happens to call it.

### Evidence of testing

- New test in `play-brief-absence.test.ts`: `resolveGammaPosture` with a live (non-stale) Vector
  regime of `"unknown"` and a resolved GEX posture of `"short"` now returns `"short"`, not
  `"unknown"` — the exact CG live repro. RED pre-fix (asserts `"short"`, function returned
  `"unknown"`), GREEN post-fix.
- `play-brief-absence.test.ts` + `play-brief-narrative.test.ts` + `play-brief-narrative-coaching.test.ts`
  + `play-brief-intel.test.ts` + `play-brief.test.ts` combined (331 tests): pass.
- `npx tsc --noEmit` (Node 20): clean.
- Full `npm test` (Node 20): running at time of write-up; CI `verify` will confirm.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, auditing
CG's full envelope (the book's strongest live winner) for genuine Largo-contract gaps beyond the
lane-rank/self-reference family already fixed this session.
