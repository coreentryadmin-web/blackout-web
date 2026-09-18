> **kind:** FINDING

## Night Hawk Legacy healthcheck's marks-verdict logic gave a false GREEN for null bid/ask

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `verdictForMarkRow` (`scripts/audit/lib/legacy-healthcheck-eval.mjs`) — the pure verdict logic behind `legacy-e2e-healthcheck.mjs`'s Stage B (marks correctness) |
| **Severity** | P3 — audit-tooling correctness, not member-facing product code. The gap is in the Legacy audit lane's own healthcheck, which this session runs every ~15 minutes as its primary marks-correctness signal — a false GREEN here means a real "no live quote validated this mark" condition would go undetected by the one tool built to catch it. |

### Root cause

`verdictForMarkRow` only performs its "no live two-sided quote" AMBER classification and its
[bid, ask] band check inside one guard:

```js
if (bid != null && ask != null) {
  if (ask <= 0) {
    return { verdict: "AMBER", evidence: `no live two-sided quote (bid=${bid}, ask=${ask}) — mark sourced from last trade/close` };
  }
  if (bid > ask) return { verdict: "RED", evidence: `bid (${bid}) > ask (${ask}) — crossed book` };
  if (mark < bid - 1e-9 || mark > ask + 1e-9) {
    return { verdict: "RED", evidence: `mark (${mark}) outside [bid=${bid}, ask=${ask}]` };
  }
}
// falls through here when bid or ask is null
return { verdict: "GREEN", evidence: `mark=${mark} within [${bid ?? "?"}, ${ask ?? "?"}]` };
```

The file's own docstring (added 2026-09-11 for a real false-RED it fixed that day) already
establishes that `bid=0, ask=0` means "no live two-sided quote — mark sourced from last
trade/close" and correctly downgrades that to AMBER rather than checking a fake `[0,0]` band.

But `bid`/`ask` being **`null`** (not `0`) is the exact same real-world condition, reached by a
different, at least as common, code path:

- `options-socket.ts`'s `handleTrade()` — a trade print (not a quote) updates the in-memory mark
  when the WS has never seen a quote for this OCC yet: `bid: prev?.bid ?? null, ask: prev?.ask ?? null`.
  With no `prev` on file, both come back `null` while `mark` is set from the trade price.
- `options-snapshot.ts`'s REST parse — `finiteOrNull(r.last_quote?.bid)` / `...ask` — comes back
  `null` (not `0`) whenever the provider returns no `last_quote` object at all, which is the more
  common "no live quote" shape than an explicit `{bid:0, ask:0}` object.

Because the guard requires **both** `bid != null && ask != null` before doing any classification,
a null/null (or one-sided-null) row skips straight past both the AMBER branch and the band check
and falls through to a bare `GREEN` — claiming the mark was checked against a live quote range
when no such check ever happened. This is the exact same "no live quote" state the file's own
2026-09-11 fix exists to catch, just arriving with `null` instead of `0`.

Reproduced directly:

```js
verdictForMarkRow({ mark: 5.01, bid: null, ask: null, stale: false })
// -> { verdict: "GREEN", evidence: "mark=5.01 within [?, ?]" }   (BEFORE the fix)
```

The `evidence` string itself is misleading in this state — `"within [?, ?]"` reads as if a range
were checked, when in fact no range existed to check against.

### Blast radius

Only `verdictForMarkRow` (and by extension `verdictForMarks`, which rolls up per-OCC verdicts from
it) is affected — no other caller. This is audit-tooling logic (`scripts/audit/`), not product
code served to members; the underlying `/api/market/nighthawk/legacy-marks` route and its
`mark`/`bid`/`ask` values are unchanged by this fix. The practical effect is on this session's own
Stage B confidence: a live Legacy OCC whose latest tick was a trade print with no prior quote on
file (illiquid weekly names are the realistic case) would have shown as indistinguishable from a
fully band-verified GREEN mark.

### Fix

Folded the null/undefined and `ask<=0` cases into one guard so every representation of "no live
two-sided quote" gets the same AMBER instead of only the `0/0` case being caught:

```js
if (bid == null || ask == null || ask <= 0) {
  return { verdict: "AMBER", evidence: `no live two-sided quote (bid=${bid ?? "null"}, ask=${ask ?? "null"}) — mark sourced from last trade/close` };
}
if (bid > ask) return { verdict: "RED", evidence: `bid (${bid}) > ask (${ask}) — crossed book` };
if (mark < bid - 1e-9 || mark > ask + 1e-9) {
  return { verdict: "RED", evidence: `mark (${mark}) outside [bid=${bid}, ask=${ask}]` };
}
```

A one-sided null (e.g. `bid: 1, ask: null`) now also correctly reads as AMBER — there is no way to
check a band with only one side of it, so it should not fall through to GREEN either.

### Why this fix, not an alternative

Considered leaving null/null as its own distinct verdict category (e.g. a new `"UNVERIFIED"`
string) instead of folding it into the existing AMBER branch — rejected as unnecessary: the
existing AMBER evidence message ("no live two-sided quote... mark sourced from last trade/close")
already describes the null/null case accurately once the `bid ?? "null"` / `ask ?? "null"`
formatting is applied, so a new verdict tier would add a distinction without a difference.

### Evidence

- Reproduced directly via `verdictForMarkRow({ mark: 5.01, bid: null, ask: null })`: printed
  `{ verdict: "GREEN", evidence: "mark=5.01 within [?, ?]" }` before the fix.
- RED: reverted `legacy-healthcheck-eval.mjs` only (kept the 2 new tests), 2/2 new tests failed as
  predicted (`bid=null/ask=null`, and the one-sided-null case).
- GREEN: restored the fix, all 41 tests in `legacy-healthcheck-eval.test.mjs` pass (39 pre-existing
  + 2 new).
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14038 tests / 14033 pass / 2 fail / 3 skipped — the 2 failures
  (`mergeBangerPositionsIntoSwingPlays` ×2, Banger/Swing merge logic) are pre-existing and
  unrelated to this change (untouched file, different subsystem).

### What was deliberately left unchanged

The `0/0` classification and its 2026-09-11 rationale (kept verbatim in the docstring, now
extended rather than replaced). The band-check math (`mark < bid - 1e-9 || mark > ask + 1e-9`) and
the crossed-book / non-finite / stale branches are untouched — only the guard controlling which
rows reach them changed. No product code (`legacy-option-mark-row.ts`, `options-socket.ts`,
`options-snapshot.ts`) was touched — the null bid/ask values themselves are legitimate, honest
signals from those layers; the bug was purely in how the audit tool's verdict logic interpreted
them.
