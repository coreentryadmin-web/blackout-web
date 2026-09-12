> **kind:** FINDING

## Ask Largo `ticker-verdict.ts` PRECEDENT line diluted (and could invert the sign of) its win-rate by counting non-directional outcomes as losses — FIXED

| **Status** | FIXED |
|---|---|
| **Area** | Ask Largo / BIE deterministic verdict (`src/lib/bie/ticker-verdict.ts`) |
| **Severity** | P3 in isolation (a math/honesty bug in the precedent citation), but see "Important context" below — this file has zero live traffic today |

### Root cause

`synthesizeTickerVerdict()`'s PRECEDENT line tallied wins with:

```ts
const prec = await findSimilarPrecedents(...);
if (prec.length >= 2) {
  const wins = prec.filter((p) => /win|hit target|target/i.test(p.chunk)).length;
  const pct = Math.round((wins / prec.length) * 100);
  precedentLine = `PRECEDENT  ${prec.length} similar ${t} setups in corpus — ~${pct}% positive outcomes...`;
}
```

Every precedent chunk here comes from `describeAuditRow()` (`precedent-search.ts`), which stamps a
trailing `"Outcome: ${outcome}."` where `outcome` is one of exactly four values —
`TERMINAL_ALERT_OUTCOMES` in `db.ts`: `target | stop | ambiguous | unfilled`. Only `target` can
ever match the win regex (`"win"`/`"hit target"` never appear in the corpus vocabulary at all), so
the numerator was always "count of target outcomes" — but the **denominator** was every returned
precedent, including `ambiguous` (thesis unclear, resolved but not directionally informative) and
`unfilled` (the alert never even triggered). Neither of those is a loss, but counting them in the
denominator without counting them as wins makes them read as losses in the printed percentage.

Concretely: 1 `target` + 2 `unfilled` precedents produced `~33% positive outcomes` — reading as a
mostly-losing precedent set — when the one precedent that actually resolved directionally was a
clean win (100% of usable evidence). The sign of the printed read could flip entirely depending on
how many unfilled/ambiguous rows happened to be in the top-k similarity results, which has nothing
to do with whether the *setup* actually worked.

This exact corpus already has a correct, established convention elsewhere in the same codebase:
`src/features/spx/lib/spx-signals-shadow-precedents.ts`'s `computePrecedentShadowFactor` reads the
identical `alert_audit_log` precedent chunks and explicitly **excludes** `ambiguous`/`unfilled`
from both sides of its for/against tally — its own doc comment: *"a resolved-but-not-directional
outcome (ambiguous/unfilled) [is] not tallied either way — real, counted-toward-total hits, just
not usable evidence for THIS comparison."* `ticker-verdict.ts` never applied that same discipline.

### Fix

Reused the SPX module's own exported `parsePrecedentOutcome()` (parses the same
`"Outcome: <target|stop|ambiguous|unfilled>."` trailer via a shared, already-tested regex) to
filter the precedent set down to only cleanly-resolved `target`/`stop` outcomes before tallying:

```ts
const resolved = prec
  .map((p) => parsePrecedentOutcome(p.chunk))
  .filter((o): o is PrecedentOutcome => o === "target" || o === "stop");
if (resolved.length >= 2) {
  const wins = resolved.filter((o) => o === "target").length;
  const pct = Math.round((wins / resolved.length) * 100);
  precedentLine = `PRECEDENT  ${resolved.length} similar ${t} setups cleanly resolved in corpus — ~${pct}% hit target...`;
}
```

The usable-evidence gate moved from `prec.length >= 2` to `resolved.length >= 2` — a corpus of 3
precedents where only 1 is directionally informative now correctly omits the line entirely rather
than printing a fabricated/misleading percentage off a single data point.

### Evidence

`src/lib/bie/ticker-verdict.test.ts`, 3 new tests (mutable `mockPrecedents` mock, same pattern
`cortex-read.test.ts` uses):
- "PRECEDENT excludes ambiguous/unfilled outcomes from the win-rate tally, not just from wins" —
  RED before fix (2 target + 2 unfilled → old code printed `~50% positive outcomes`; correct is
  `2 similar ... cleanly resolved ... ~100% hit target`, unfilled excluded from both sides).
- "PRECEDENT is omitted (not a fabricated 0%) when fewer than 2 precedents cleanly resolved
  target/stop" — 1 target + 1 ambiguous + 1 unfilled → line must not render at all.
- "PRECEDENT tallies stop outcomes against target, ignoring ambiguous noise mixed in" — 1 target +
  2 stop + 1 ambiguous → `3 similar ... cleanly resolved ... ~33% hit target`.

RED→GREEN proven via `git stash` isolating the `.ts` fix from the new tests: 3/9 fail against the
pre-fix implementation (exactly the 3 new tests), 9/9 pass post-fix. Full `npm test`: 13946 pass /
0 fail / 3 skipped (pre-existing, unrelated). `npx tsc --noEmit` clean.

### Blast radius

Only this one PRECEDENT-line computation in `ticker-verdict.ts` reads precedent outcomes; no other
function in the file (or elsewhere — confirmed no other call site imports
`synthesizeTickerVerdict`/`formatTickerVerdictMarkdown`, see "Important context") touches this
corpus. `spx-signals-shadow-precedents.ts` (the sibling this fix now matches) is untouched — it
was already correct.

### Fix rationale

Reused the SPX module's exported `parsePrecedentOutcome`/`PrecedentOutcome` rather than
reimplementing outcome parsing a third time (a `bie/` module importing from `features/spx/lib/` is
an already-established pattern in this codebase — `ecosystem-context.ts`, `spx-desk-synthesis.ts`,
`spx-invalidation.ts`, `spx-live-voice.ts` and others already do it) — one parser, one source of
truth for what a precedent chunk's outcome trailer means, rather than a second regex that could
drift from the first.

### Important context found while investigating this file further (not a new finding — re-confirms an existing, actively-discussed one)

While looking for bugs in `ticker-verdict.ts` beyond today's earlier condor-gating fix, traced
whether `synthesizeTickerVerdict`/`formatTickerVerdictMarkdown` are actually reachable from a real
member turn. They are not: `grep -rn "synthesizeTickerVerdict\|formatTickerVerdictMarkdown" src`
outside this file's own test returns nothing, and the same is true of the "verdict" intent's
*real* composer (`src/lib/bie/verdict.ts`'s `composeVerdict`/`verdict-core.ts`) and of
`classifyBieIntent` (`src/lib/bie/router.ts`) itself — `grep -rn "classifyBieIntent(" src` outside
tests returns only the function's own definition. `src/lib/largo-terminal.ts`'s `runLargoQuery`
(the actual live entry point behind `POST /api/market/largo/query`) goes straight from
`prepareLargoTurn`'s own `analyzeLargoQuestion` intent analysis to `anthropicToolLoop` — there is
no BIE-router dispatch anywhere in the live path.

This is **not a new discovery** — it is exactly `docs/audit/FINDINGS.md`'s 2026-09-11 entry ("The
entire BIE deterministic router... has been unreachable from live Largo chat since the 2026-07-17
sandbox migration — REPORTED, NOT FIXED"), which is under active discussion on the standing #4076
collaboration thread as recently as this same day (2026-09-12 03:12 UTC, "Second opinion on the BIE
router question... recommend staged shadow-mode recovery"). Recorded here only so a future session
reading today's earlier condor-gating finding (which describes `ticker-verdict.ts` as "the
deterministic (no-Claude-cost) fast path for advice-shaped questions... fires on every such
question") does not take that framing at face value — per the 2026-09-11 finding's own evidence,
it fires on zero live member questions today. The math fix above is still worth having regardless
(this file is actively being kept correct in anticipation of the router recovery decision — it
received a real fix earlier today), but it should not be read as a live member-facing fix. No
action was taken on the router-wiring question itself here, consistent with the 2026-09-11
finding's own conclusion that it needs an architectural decision, not a mechanical patch, and the
question is already being actively worked by both agents on #4076 — duplicating that discussion
was deliberately avoided.
