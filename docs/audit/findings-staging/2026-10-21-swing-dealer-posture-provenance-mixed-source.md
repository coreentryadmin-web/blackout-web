## 2026-10-21 — [FINDING, swing] "Dealer posture" evidence tagged provenance `"Vector"` even when every printed figure was GEX-matrix content

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C8 provenance violation — a member tracing "where did this number come from" is pointed at the wrong engine) |
| **Surface** | `src/lib/swing/play-brief.ts` — `evidenceFromContext()`'s "Dealer posture" `calc` entry |

### Root cause

The "Dealer posture" evidence entry's `provenance.source` was tagged purely off `postureFromVec` —
whether the DIRECTIONAL WORD (`γ short`/`γ long`) resolved from Vector's own `regime.posture`. But
the net-GEX dollar figure pushed into the same line (`net GEX ${...}`) has no Vector equivalent
anywhere in this function — it is unconditionally read from `gex.net_gex` whenever `gex` is present
and fresh. So a genuinely-resolved Vector posture that happens to agree with a fresh GEX matrix's
own posture got the WHOLE line tagged `(Vector · ...)`, even when the printed net-GEX figure (and, in
the live repro, the nearest-wall figure too) was verbatim GEX-matrix content.

### Evidence

Live repro (closed GOOGL play-brief, Ask Largo broader multi-ticker audit, 2026-10-21):

```
[CALC] Dealer posture: γ short · net GEX +157.7M · nearest wall 337.50 (-2.4 pts) _(Vector · 2026-10-21 04:47 ET)_
```

vs. the SAME document's own sections:

```
## GEX posture
Gamma posture: dealers short gamma ... Net GEX: 157.7M ... Nearest wall: 337.50 (support, -2.4 pts from spot 339.85)

## Vector desk
Current Vector read: grade A · conviction 76
```

Every figure in the tagged-"Vector" evidence line matches the "## GEX posture" section verbatim; the
"## Vector desk" section carries only grade/conviction, no GEX data at all for this read. The sibling
TSLA-closed document in the same sweep correctly tagged the identical fact type `(GEX · ...)`,
confirming this was a mislabel rather than an intentional alternate-source design.

Added a RED repro mirroring the live shape (Vector regime genuinely resolved to "short", no
`gexWalls` on the vector fixture, a fresh GEX matrix supplying `net_gex`) asserting
`provenance.source === "GEX"`. RED→GREEN, git-stash-verified on the source file alone: 163/164 (1
fail) before the fix, 164/164 after. `tsc --noEmit` clean.

### Blast radius

Single evidence entry in a single function (`evidenceFromContext`). No other provenance tag in this
function shares the same `postureFromVec`-only logic — confirmed by reading every other
`provenance.source` assignment in the surrounding ~150 lines, each keyed to its own, unrelated
condition (Swing ledger, HELIX, Earnings calendar, GEX/Vector session notes).

### Fix

Hoisted a `netGexFromGex` boolean, set `true` only inside the branch that actually appends the
net-GEX figure (`gex && !gexStale && Number.isFinite(gex.net_gex)`). The provenance tag now uses
`sourceIsVector = postureFromVec && !netGexFromGex` in place of the bare `postureFromVec` for all
four provenance fields (`source`, `asOf`, `freshness`, `market_session_note`) — "Vector" only applies
when the posture word resolved from Vector AND no GEX-only figure got appended; any line carrying the
net-GEX figure is now correctly attributed to GEX regardless of where the directional word came from.

### Why not a bigger fix

Did not attempt to also track whether the nearest-wall figure specifically came from Vector's
`gexWalls` vs. the GEX-matrix fallback (`vecCallWallPosture ?? gex.call_wall`) — that sub-case isn't
demonstrated broken by any live evidence (the repro's wall figure happened to match GEX only because
Vector had no wall data at all for that read), and a precise per-figure provenance split for the wall
specifically would need plumbing a second flag out of a nested scope for no evidenced defect. The
net-GEX figure is the one unconditionally-GEX-only signal in this function, and fixing on that signal
directly resolves the live repro without speculative over-correction.
