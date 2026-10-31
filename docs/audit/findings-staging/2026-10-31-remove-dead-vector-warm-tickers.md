> **kind:** FINDING

## `vectorWarmTickers()` in `src/lib/heatmap-allowlist.ts` — dead passthrough, zero callers — REMOVED

| | |
|---|---|
| **Area** | Heatmap/Vector overlay allowlist (`src/lib/heatmap-allowlist.ts`) |
| **Severity** | P4 (dead code, zero runtime impact) |
| **Status** | FIXED |

### Root cause

`vectorWarmTickers()` was a bare passthrough added in #691 ("multi-ticker chart, scanner, crons,
dark-pool cache"):

```ts
export function vectorWarmTickers(): string[] {
  return vectorUniverseTickers();
}
```

The warm/record batch (`heatmap-warm`, `vector-walls-warm` crons, the Vector recorder) moved to
`listSharedUniverseTickers()` (static ∪ dynamic ≤100/14d — the static half supplied by this
module's own `vectorUniverseTickers()`, the dynamic half added on top) per #1289. The function's
own doc comment already recorded this supersession and explicitly warned against resurrecting it:

> Static warm/allowlist subset only. Live `heatmap-warm` + Vector recorder use
> `listSharedUniverseTickers()` (static ∪ dynamic ≤100 / 14d) — do not reintroduce this as the warm
> batch or Thermal and Vector drift apart again.

Since #1289 landed, `vectorWarmTickers` has had no remaining callers anywhere in the repository —
it was exported but never imported, confirmed by a repo-wide word-boundary grep covering every
file extension (`.ts`/`.tsx`/`.js`/`.cjs`/`.mjs`/`.yml`/`.yaml`), not only `src/`.

### Why it wasn't caught earlier

The comment correctly documents *why not to reintroduce it as the warm batch*, but a
"do not reintroduce X" note on an already-dead export reads, on a skim, as an active guardrail
protecting a live code path rather than a flag that the function itself should have been deleted
once its own last caller moved to `listSharedUniverseTickers()`. The function kept compiling
cleanly (it's a self-contained one-line passthrough with no broken dependency to surface a type
error), so nothing forced the removal.

### Evidence

- `grep -rn "vectorWarmTickers" .` from a fresh `origin/main` checkout (repo root, all file
  types): exactly one hit — the declaration itself
  (`src/lib/heatmap-allowlist.ts:144`, pre-fix).
- `git log --oneline --all -S"vectorWarmTickers" -- src/lib/heatmap-allowlist.ts`: only the
  original add (#691) ever touches the symbol; no later commit added a new reference.
- Confirmed the warm batch's real caller: `grep -rln "listSharedUniverseTickers" src/` shows
  `heatmap-warm/route.ts`, `vector-walls-warm/route.ts`, `vector-bead-recorder-core.ts`,
  `vector-full-state-warm-universe.ts` etc. already call the superseding function directly —
  nothing was left depending on the dead alias.

### Blast radius

None. `vectorWarmTickers` had no importers anywhere in `src/` (verified via the grep above both
before and after removal on a fresh worktree off `origin/main`).

### Fix rationale

Deleted the function outright, matching the module's own stated intent ("do not reintroduce
this as the warm batch"). Kept the still-used `vectorUniverseTickers()` it called (that one is a
real, actively-consumed export — `listSharedUniverseTickers`'s static half and the sector-grid
test's own budget check both use it) and `isHeatmapPreset` untouched.

Added a regression guard to `heatmap-allowlist.test.ts` asserting the module no longer exports
`vectorWarmTickers`, proven RED→GREEN via `git stash` on the source file alone: pre-fix the new
test fails (`[Function: vectorWarmTickers]` is defined), post-fix it passes (`undefined`). This
turns "do not reintroduce this as the warm batch" from a comment someone has to notice into a test
that fails loudly if the dead alias is ever restored without being wired to a real caller.

### Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/heatmap-allowlist.test.ts` — 3/3 green
  post-fix; the new guard test fails pre-fix (RED→GREEN proof via `git stash`).
- `npx tsx --experimental-test-module-mocks --test src/lib/heatmap-allowlist.test.ts
  src/features/vector/lib/vector-universe.test.ts
  src/features/vector/lib/vector-full-state-warm-universe.test.ts` — 35/35 green, no regressions
  in callers of the surviving `vectorUniverseTickers()`/`listSharedUniverseTickers()` chain.
- `npx tsc --noEmit` and `npx eslint src/lib/heatmap-allowlist.ts
  src/lib/heatmap-allowlist.test.ts` — both clean.
