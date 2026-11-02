> **kind:** FINDING

## Helix Flow Cluster Panel chains strikes arbitrarily far apart into one reported "campaign" — FIXED

**Status:** FIXED (`fix/helix-flow-cluster-chain`)

### Root cause

`src/features/helix/lib/helix-flow-clusters.ts`'s `clusterFlowPrints` (consumed by
`FlowClusterPanel.tsx`, the "Flow campaigns" rail on `/flows`) groups same-ticker/
same-side prints whose strike is "near" an existing cluster, within a 5-minute
window, into one reported campaign row.

The merge test compared each new print's strike against `c.strike` — the
cluster's **premium-weighted running average**, which is recomputed and drifts
every time a new print merges in:

```ts
if (!strikesNear(c.strike, a.strike, spot)) continue;
```

That running average is the WRONG thing to test a new print against for deciding
cluster membership, because it moves. A sequence of individually-"near" steps can
walk the cluster's represented strike arbitrarily far from where it actually
started, as long as every new print stays within `HELIX_FLOW_CLUSTER_STRIKE_TOL_PCT`
(2%) of wherever the average has drifted to *by the time that print arrives* — not
within 2% of the strike that founded the cluster. This is the classic "chaining"
failure mode of single-link/centroid-following clustering.

### Evidence

Reproduced directly against the shipped function (`spot = 1000`, so the 2% tolerance
is a ~20-point band) with 12 prints stepping 19 points apart (1000, 1019, 1038, …,
1209) and front-loaded premium weighting — each print's premium ~1000x the
cluster's cumulative premium so far, which pulls the running average onto the
*latest* strike every time, letting the chain walk indefinitely:

```
BEFORE FIX: 1 cluster, printCount=12, reported strike ≈ 1208.98
  — merging strikes 1000 through 1209, a 209-point (~21%) spread,
    more than 10x the stated 2% "nearby strikes" tolerance.

AFTER FIX: 6 clusters, printCount=2 each, correctly bounded to pairs within the
  real tolerance of their own founding strike.
```

Confirmed RED→GREEN: the new regression test
(`src/features/helix/lib/helix-flow-clusters.test.ts`, "does not chain strikes far
beyond tolerance via a drifting running average") fails against the pre-fix source
(`cluster at strike 1208.98... merged 12 prints`) and passes against the fix.

### Blast radius

Single call site: `FlowClusterPanel.tsx` ("Flow campaigns" rail on the Helix
`/flows` desk) is the only consumer of `clusterFlowPrints`. No other surface reads
this module.

Product impact: a member reading the Flow Cluster panel sees "N prints, same
strike, coordinated" for what can actually be a chain of prints spanning a strike
range many multiples of the panel's own stated 2% "nearby strikes" rule — e.g. 12
real, independent prints at wildly different strikes misreported as one tight,
same-level campaign. This directly undercuts the panel's stated thesis ("Same
ticker/side · nearby strikes · 5m window" — "whale story... repeated fills at one
strike is a thesis"), since the whole point of the panel is to distinguish a real
same-strike campaign from unrelated activity.

### Fix rationale

Added an immutable `_anchorStrike` field to each in-progress cluster, set once at
creation time to the strike of the print that founded the cluster. The merge
candidacy check now compares a new print against `c._anchorStrike` (fixed) instead
of `c.strike` (the drifting, premium-weighted display value). This directly
matches what "nearby strikes" means: every member must be within tolerance of the
cluster's actual founding strike, not of wherever the running average has wandered.

Deliberately left unchanged: the *reported* `strike` field stays the premium-
weighted average — that is still the right representative value to show for a
genuine same-strike cluster, it is only wrong as the thing new candidates are
tested against. `_anchorStrike` is internal bookkeeping, stripped (alongside the
other internal `_lastMs`/`_askSum`/`_askN` fields) before the cluster is returned,
so the public `HelixFlowCluster` shape and every existing caller/test are
unaffected.

An alternative considered and rejected: requiring every NEW print to be within
tolerance of every EXISTING member (an O(n) check per candidate instead of O(1)).
That is strictly more conservative but changes behavior in legitimate cases where
real strikes drift gradually by small, intentional amounts within tolerance of the
anchor (e.g. 100 → 101 → 102, all within 2% of 100 and of each other) — the
anchor-only check preserves that intended behavior exactly (see the existing
"merges nearby strikes within window" test) while closing the unbounded-drift case.
