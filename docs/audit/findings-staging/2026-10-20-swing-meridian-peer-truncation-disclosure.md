## A swing play-brief's earnings peer-history line silently dropped up to 3 qualifying sector peers with no disclosure — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate — a fresh-angle Workflow audit reading
`play-brief-meridian-peer-core.ts` directly, targeting source not yet deep-audited this cycle,
adversarially verified (2-agent pipeline: investigation + independent skeptic re-trace against
current source; confirmed real).

**Root cause:** `meridianPeerEarningsCoaching`'s peer-history snippet did a bare
`peers.slice(0, 3)` with no check against `peers.length`:

```ts
const peers = (peer.members ?? []).filter((m) => !m.is_subject && m.beat_rate_n >= 3);
if (peers.length) {
  const snippets = peers
    .slice(0, 3)
    .map((m) => { ... })
    .join(" · ");
  parts.push(`peer history: ${snippets}`);
}
```

Up to `MAX_PEER_REACTION_TICKERS = 6` (`meridian-sector-core.ts`) non-subject peers can legitimately
carry real `beat_rate_n >= 3` data (`peerTickersForReactionFetch` fetches reaction history for up
to 6 non-subject cohort members), so `peers.length` can reach 4-6 — and in every such case, 1-3 of
them were silently dropped with zero disclosure that the cohort was larger than the 3 names shown.
A trader reading the peer-history line had no way to know the real cohort size.

This is the exact same Largo C3 (absence-must-be-disclosed) defect class already fixed the same
day in `play-brief-diff.ts`'s `envelopeWithDiffSection` (bare `lines.slice(0, 8)` → disclosed
overflow count), and the correct pattern already existed a few lines away in the same file family —
`play-brief-intel.ts`'s `meridianCatalystsSection` computes `droppedForWindow` and discloses it as
`"_N more in window — ..._"`. `meridianPeerEarningsCoaching`'s peer-history block never got the
same treatment.

**Live impact:** reachable on any swing play with a near-term earnings catalyst whose sector cohort
has more than 3 qualifying (sufficiently-sampled) peers — not an edge case for a liquid/well-covered
sector.

**Fix:** The peer-history snippet now computes the overflow count and appends
`"(+N more peers not shown)"` when more than 3 peers qualify, mirroring the existing
`droppedForWindow` pattern exactly.

**Fix rationale:** Same minimal, already-established disclosure idiom used twice elsewhere in this
file family today — no new mechanism invented, just applied consistently to the one call site that
was missing it.

**Blast radius:** Single function (`meridianPeerEarningsCoaching`, `play-brief-meridian-peer-core.ts`).
Checked all 3 other references in the repo (`play-brief-intel.ts`'s caller, `play-brief-meridian-peer.ts`'s
re-export, a comment in `play-brief-narrative-coaching.ts`) — none re-truncate or otherwise
post-process the returned string, so the disclosure reaches the member unmodified.

**Tests:** 1 new regression test — 5 qualifying peers (only `MAX_PEER_REACTION_TICKERS=6`-bounded
cohorts can reach this), asserts the first 3 are named inline, the other 2 are NOT named, and the
overflow count `"+2 more peers not shown"` is present. RED→GREEN proven via `git stash` (fails
against the pre-fix source — old code silently included/excluded peers with no count — passes
post-fix). `tsc --noEmit` clean. Full `play-brief-meridian-peer.test.ts` (9 tests) green.
