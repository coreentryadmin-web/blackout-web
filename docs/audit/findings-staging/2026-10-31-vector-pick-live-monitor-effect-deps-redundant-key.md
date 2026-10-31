> **kind:** FINDING

## Vector `useVectorPickLiveMonitor`: raw `picks` in the live-quote poll effect's deps defeated its own `pickKey` — FIXED

**Status:** Fixed, regression tests added (`src/features/vector/lib/use-vector-pick-live-monitor.test.ts`).

### Root cause

`useVectorPickLiveMonitor` (`src/features/vector/lib/use-vector-pick-live-monitor.ts`) already
computes a deliberately **stable** `pickKey` — `picks.map((p) => \`${p.occ}|${p.strike}|${p.expiry}\`).join(";")`
— whose only visible purpose (it was never read anywhere else in the file before this fix) was to
let the live-quote poll effect tell "the same set of picks, refreshed" apart from "a genuinely
different set of picks."

But the effect's dependency array listed `pickKey` **and** the raw `picks` array:

```ts
}, [ticker, emit, pickKey, picks, liveSession, paused]);
```

`useVectorContractPicks` (the sole producer of the `picks`/`pool` this hook receives, via
`useVectorActionablePicks`) calls `setPicks(res.pool?.length ? res.pool : (res.picks ?? []))` on
every ~45s refetch — a **brand-new array instance every time**, even when the returned
occ/strike/expiry identities are byte-identical to what was already showing. `pickKey` would stay
unchanged in that case, but the raw `picks` reference still changed, and the raw dependency still
tore the effect down and rebuilt it:

- `cancelled = true` + `clearInterval(id)` on the OLD 1s poll loop.
- `genRef.current` bumped, so any live-quote fetch already in flight when the 45s refetch landed
  has its `.then()` response silently dropped (`if (cancelled || genRef.current !== gen) return;`).
- A brand-new `poll()` fires immediately and a brand-new `setInterval` starts, resetting the 1s
  cadence's phase.

This is the exact "a derived stable key is computed but a raw unstable value sits in the same
dependency array, defeating the key's whole purpose" class just fixed one hook over, in the sibling
`useVectorContractPicks` fetch effect (PR for
`2026-10-31-vector-contract-picks-effect-deps-starvation.md`) — same lifecycle
(`useVectorActionablePicks` → `useVectorContractPicks` fetch feeds `useVectorPickLiveMonitor`'s
poll), same shape of bug, independently present in the next hook down the chain.

### Evidence

- Read `use-vector-contract-picks.ts`'s `setPicks` call sites: every completed fetch (success OR
  the empty-fallback branches) calls `setPicks(...)` with a freshly-built array, unconditionally —
  there is no "same content, skip the setState" short-circuit anywhere in that hook.
- Confirmed `pickKey` was computed but used NOWHERE else in the file except this one dependency
  array slot — its entire reason to exist is to be the thing the effect restarts on, which the
  co-present raw `picks` makes moot.
- No React rendering harness exists in this repo (established precedent, e.g.
  `VectorScanner.test.ts`), so the regression test asserts the fix against the source text:
  - the poll effect's deps array is exactly `[ticker, emit, pickKey, liveSession, paused]` (no raw
    `picks`);
  - `picksRef`/`picksRef.current = picks` exist and `poll()` sources `occPicks` from
    `picksRef.current`, not the closed-over `picks` param.
- **RED (pre-fix, via `git stash` on the source file alone, keeping the new tests):** both new
  assertions failed against the unmodified source (`picks` present in the deps array; no
  `picksRef`/`picksRef.current.filter` in the source).
- **GREEN (fix restored):** both pass.
- `npx tsc --noEmit` clean. `npx eslint` on the changed file: 0 new warnings (one pre-existing,
  unrelated `useMemo`/`pollTick` warning on this same file is already present on `main` before this
  change and is left untouched — out of scope here).
- Full blast-radius re-run: every `.test.ts` in `src/features/vector/lib/` — 1316 tests / 11 suites,
  all pass.

### Blast radius

Only `useVectorPickLiveMonitor` changes. Its sole consumer, `useVectorActionablePicks`, passes the
hook's return value straight through; neither it nor anything further up the tree
(`VectorComparePlayStrip`/`VectorContractPicksCard`) observes this hook's internal effect timing —
they only see `monitored` (the mapped array this hook returns), whose shape is unchanged by this
fix.

### Fix rationale

Added a `picksRef` (mirrored every render via its own small `useEffect([picks])`, the same
ref-mirroring convention already used in this file family — e.g. `onFlowFlashRef` in
`use-vector-helix-flows.ts`) and had `poll()` read `occPicks` from `picksRef.current` instead of
the closed-over `picks` parameter. The live-quote poll effect's dependency array now lists
`pickKey` alone (not also raw `picks`) to decide when to restart the timer, while `poll()` — whether
invoked immediately or by the running `setInterval` — always sees the CURRENT picks (fresh
premium/confidence/rank/label/role/caveat fields) through the ref, even on a 45s refetch that
leaves `pickKey` unchanged. The pre-existing `if (paused || !emit?.play || picks.length === 0 ||
!liveSession)` guard at the top of the effect is left reading the closed-over `picks` parameter
directly — that's correct as-is, since it only runs at the moment the effect itself (re)runs, which
by construction coincides with whatever `picks` triggered that run.

Considered and rejected: dropping `pickKey` entirely and keying off `picks.length` or similar
(would reintroduce exactly the restart-on-every-45s-refetch behavior this fix removes, since
`picks.length` is just as likely to be unchanged-but-reference-different as the whole array);
clearing `liveByOcc`/`lastSuccessAtRef` on every `picks` reference change "to be safe" (would
reintroduce the staleness/outage-misread risk `isLiveQuotesStale`'s own `pollTick` mechanism exists
to prevent, and is unnecessary — the live quotes keyed by OCC in `liveByOcc` remain valid across an
identity-preserving refetch, which is precisely why `pickKey`, not raw `picks`, is the right gate).

### Deliberately left unchanged

- The `emit` (raw `VectorPlayEmit | null`) dependency — unlike `picks`, there is no derived stable
  key for `emit` in this hook, and `poll()`'s closure reads `emit.spot`/`emit.play`/`emit.callWall`/
  etc. directly (not via a ref), so a genuine `emit` change (which `emitPlay()` in `VectorChart.tsx`
  already dedupes to real headline/conviction/grade/entryZone changes, not every tick) correctly
  needs to restart the poll so its next payload reflects the new play. Decoupling `emit` from the
  restart trigger the way `picks` was decoupled here is a larger, independently-scoped change (it
  would need its own ref-mirroring plus a derived key analogous to `pickKey`) and is not needed to
  fix the bug found — out of scope for this PR.
- The pre-existing `pollTick`/`useMemo` `react-hooks/exhaustive-deps` warning on this same file —
  present on `main` before this change, unrelated to the fix, left as-is.
