> **kind:** FINDING

## `deskPulseStructureCacheTtlMs()` invalid-override fallback reverts to 10s, not the documented/intended 2s — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/config.ts` (SPX desk pulse-structure cache TTL) |
| **Severity** | P3 (latent — only reachable with a malformed env override) |
| **Status** | Fixed |

### Root cause

`deskPulseStructureCacheTtlMs()` reads `SPX_PULSE_STRUCTURE_SEC`, defaults to `2` seconds when unset,
and is documented (both in its own doc comment and in the 2026-08-24 finding it cites) as having a
**2s** TTL specifically to cut intraday lod/hod staleness that used to lag live pulse structure
(EMAs, minute bars) by up to 5s.

```ts
export function deskPulseStructureCacheTtlMs(): number {
  const raw = process.env.SPX_PULSE_STRUCTURE_SEC?.trim();
  const sec = raw ? Number(raw) : 2;
  if (!Number.isFinite(sec) || sec < 0) return 10_000;   // <-- stale fallback
  return Math.round(sec * 1000);
}
```

The *invalid-override* fallback branch — taken when `SPX_PULSE_STRUCTURE_SEC` is set to something
non-numeric or negative — hard-codes `10_000`ms, five times the function's own intended 2s ceiling.

`git log -p` on this function shows exactly how this drifted: the default `sec` value was
tightened twice (`10 -> 5 -> 2`, most recently in commit `50ef24e` / 2026-08-24, specifically to
fix the lod/hod staleness bug this same file documents), but the invalid-input fallback constant
was never updated alongside either change. It still carries the value that matched the function's
*original*, decommissioned 10s default from when the function was first written. Every sibling TTL
function in this same file (`deskCacheTtlMs`, `deskPulseCacheTtlMs`, `deskFlowCacheTtlMs`,
`flowsCacheTtlMs`, `nighthawkEditionCacheTtlMs`, …) keeps its fallback constant in lockstep with its
own default — this was the one outlier.

### Evidence (RED → GREEN)

Added `src/lib/providers/config.test.ts`. Pre-fix (stashed the fix and re-ran):

```
deskPulseStructureCacheTtlMs: a non-numeric override falls back to 2s, not 10s
  Expected values to be strictly equal: 10000 !== 2000

deskPulseStructureCacheTtlMs: a negative override falls back to 2s, not 10s
  Expected values to be strictly equal: 10000 !== 2000

# pass 2
# fail 2
```

Post-fix: `# pass 4 / # fail 0`.

### Blast radius

Single call site: `src/features/spx/lib/spx-desk.ts` uses this TTL to cache the pulse-structure
lane (EMAs/minute bars/mega-cap structure) behind `server-cache.ts`. No other function in this file
shares the bug — every other TTL/max-block helper's invalid-input fallback already matches its own
current default (verified by inspection of all 20 functions in `config.ts`). The only way to hit
the buggy branch is an operator (or automation) setting `SPX_PULSE_STRUCTURE_SEC` to a non-numeric
or negative value — unset (the common case) always took the correct `sec=2` default path and was
never affected. When hit, the effect is a silent 5x staleness regression on pulse-structure data
(lod/hod, EMAs) feeding pin-forecast/GEX-anchoring reads — exactly the class of bug the 2026-08-24
finding this file cites was written to fix, reopened through the one path nobody checked.

### Fix rationale

Changed the fallback constant from `10_000` to `2_000` so it matches the function's own current
default, with an in-code comment naming the `10 -> 5 -> 2` history so a future default change
remembers to update this branch too. No behavior changes on the common (unset or valid) paths —
only the previously-unreachable-by-tests invalid-input branch moves from 10s to the documented 2s.
No alternative considered: making the fallback derive from the same literal as the default (e.g. a
shared constant) would be a larger refactor across every sibling function in this file for no
additional correctness benefit here: the fix is a one-line value correction, kept symmetric with
how every sibling function in the file already works.
