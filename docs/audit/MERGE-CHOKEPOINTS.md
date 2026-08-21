# Merge chokepoints — why every lane blocks every other lane

**Measured 2026-08-21, 30 open agent PRs.** Reproduce with
`node scripts/audit/agent-pr-sweep.mjs --chokepoints`.

| file | PRs touching it | lanes |
|---|---|---|
| `src/lib/largo/tool-defs.ts` | **16 of 30** | helix, meridian, nighthawk, thermal, vector |
| `src/lib/largo/product-reads.ts` | **9 of 30** | helix, nighthawk, thermal, vector |
| everything else | ≤3 | mostly single-lane |

## The finding

More than half the fleet's open work touches ONE file, and **every product lane touches it**. The
drop to the next tier is an order of magnitude — third place is 3 PRs, all from a single lane.

This is not bad luck and it is not a sequencing failure. It is the shape of the code. Both files are
per-product registries living in one module, so a lane cannot ship anything Largo-facing without
editing a file every other lane is also editing. **Collisions are therefore permanent and
independent of how carefully anyone sequences releases.**

Everything built on 2026-08-21 to manage this — the cross-PR ordering rule in `CLAUDE.md`, the
collision detector in the sweep, the deferral guard in `agent-pr-release.yml` — is symptom
management. Correct, worth having, and not a fix. Those tools make a bad answer safe; they do not
make the question stop having a bad answer.

## The fix, and why it has not been done yet

Split both files per product behind a barrel: `tool-defs/{helix,thermal,vector,meridian,nighthawk,
spx}.ts` composed by `tool-defs/index.ts`, same for `product-reads`. Each lane then edits only its
own file, and cross-lane collisions on these paths go to approximately zero.

**The cost is one rebase for every PR currently touching the file** — 16 for `tool-defs.ts` today,
across five lanes, most of them green and waiting to merge. Doing it now would invalidate more work
than it saves, and would do so at the exact moment the backlog is largest.

So it is **sequenced, not deferred indefinitely**. The trigger is measurable:

> Run `--chokepoints`. When `tool-defs.ts` is in **single digits**, do the split — as ONE PR, landed
> immediately, before the count climbs again.

If the count never falls that far on its own, that is itself the finding: it means lanes are
producing Largo-boundary work faster than it can land, and the split should be forced during a
deliberate freeze rather than waited for.

## Why this is written down rather than just done

A refactor whose cost depends on the state of the queue is a decision with a **timing** component,
and timing decisions are the ones that get lost. Without a written trigger this becomes "we should
split those files sometime", which is how the current situation arose. The measurement is
reproducible on demand precisely so the window can be recognised rather than guessed at.

## What NOT to conclude

**Do not weaken the collision guards once the split lands.** They are cheap, they are general, and
the next god-module will not announce itself either. `product-reads.ts` was not a chokepoint when it
was written.

**Do not split files that are merely popular.** Third place on this list is 3 PRs from one lane —
that is a lane working on its own code, which is exactly right and needs no intervention. The
signal here is specifically *many PRs × many lanes* on one file.
