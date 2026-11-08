> **kind:** FINDING

## `GET /api/market/heatmap` stamped only a bare UTC `as_of` with no ET session anchor (Largo C1 known gap)

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/app/api/market/heatmap/route.ts` (sector/mover heatmap HTTP read) |
| **Severity** | P3 (data-completeness / Largo contract gap, not a crash) |
| **Round** | 430 |

### Root cause

`src/app/api/market/heatmap/route.ts` has two response sites, both stamping a bare UTC instant
and nothing else:

```ts
// degraded-config path (Polygon not configured)
{ error: "Market data unavailable", sectors: [], movers: [], as_of: new Date().toISOString() }

// success path
roundFloats({ source: "market", sectors, movers, as_of: new Date().toISOString() })
```

This file was already a listed, acknowledged `KNOWN_GAPS` entry in the Largo C1 session-anchor
ratchet (`src/lib/largo/contract/session-anchor.test.ts`) — a real gap, not an exemption. Per that
contract's own docblock: after ~20:00 ET the UTC *calendar date* is already tomorrow, so any
consumer resolving "today's session" purely from `as_of`'s own date reads a full session ahead for
the last ~4 hours of RTH — the same inversion class fixed in #2418/#2420/#2422 and, this session, in
#7593/#7595/#7596/#7597/#7598/#7599/#7631.

### Evidence (RED → GREEN)

Added a regression test to the route's existing test file asserting every `as_of:` construction
site in the route source carries a matching `session_date: etSessionDate(...)` anchor beside it.
Reverting only the route file (with the `KNOWN_GAPS` entry already removed) reproduces RED:

```
# tests 8 / pass 6 / fail 2
```

Restoring the fix: `# tests 8 / pass 8 / fail 0`. The Largo C1 ratchet itself
(`session-anchor.test.ts`) also passes clean (8/8) with the entry removed, including the
"the known-gap list SHRINKS" check. `tsc --noEmit` is clean project-wide.

### Blast radius

Single file, two construction sites (the degraded-config error response and the success
response) — both fixed identically, each anchored to its own single `nowMs` instant so `as_of`
and `session_date` can never describe different moments. No other file constructs this route's
`as_of`.

### Fix rationale

Additive per the Largo contract's own rule: `as_of` stays byte-for-byte unchanged, a new
`session_date: string | null` field is added via the shared `etSessionDate()` helper
(`@/lib/largo/temporal/bar-session-date`) — the identical mechanical pattern used by every prior
C1 fix this session. The now-closed `KNOWN_GAPS` entry for this file is removed.
