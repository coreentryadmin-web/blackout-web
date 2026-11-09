> **kind:** FINDING

## Largo's live-feed pre-population computes `spx_confluence`/`lotto_live`/`power_hour` so the model "sees it without a tool-call round-trip" — then never renders any of the three, so every pre-fetch was spent for nothing

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/largo/largo-live-feed.ts` (`formatLargoLiveFeed` — the prose block injected into Largo's system prompt every turn) |
| **Severity** | P2 (wasted upstream reads on every SPX-scoped turn, AND a real proactive-context gap — the model can't cite what it never saw, and still pays the "round trip" the pre-population exists specifically to avoid) |
| **Round** | 433 |

### Root cause

`captureLargoLiveFeed` pre-populates three fields on every turn where `intent.needsSpxDesk ||
scopeTicker === "SPX"` (or, for `power_hour`, unconditionally inside the last RTH hour), with
explicit comments stating WHY:

```ts
// Pre-populate spx_confluence — same logic as get_spx_confluence tool but without the
// tool-call round-trip. ... ensures confluence is ALWAYS pre-populated for SPX desk
// questions regardless of auth state.
...
const confluence = computeSpxConfluence(desk);
feed.spx_confluence = confluence ?? { error: "No confluence — SPX desk not live yet." };
...
// Pre-populate lotto_live — synchronous Postgres/Redis read, negligible cost.
// Always inject when the SPX desk is in scope so Largo has lotto context for desk questions.
...
const rec = await loadLottoRecord();
feed.lotto_live = rec ?? { available: false, note: "No live lotto record for today yet." };
...
// Power hour — inject when within the last 60 minutes of RTH (3:00–4:00pm ET).
...
feed.power_hour = { active: true, minutes_remaining: POWER_HOUR_END - minuteOfDay };
```

But the raw `LargoLiveFeed` object `captureLargoLiveFeed` returns is **never itself sent to the
model**. Its only two consumers are:

1. `formatLargoLiveFeed(liveFeed, ...)` — turns the object into the actual prose block
   (`liveFeedBlock`) spliced into the system prompt (`largo-terminal.ts:388,861`). This is what
   the model reads *while generating* its answer.
2. `Object.values(liveFeed).filter((v) => v != null)` → `capturedResults` (`largo-terminal.ts:901,
   1071, 1375`) — used **after** generation, purely for answer-grounding (`collectContextNumbers`,
   `findSourceConflicts`, `buildMarketEvidence`): checking whether the model's *already-produced*
   text invented a number, not giving the model anything to read.

Grepping the entire body of `formatLargoLiveFeed` (458 lines, 22 distinct `feed.<key>` reads)
confirmed it never reads `feed.spx_confluence`, `feed.lotto_live`, or `feed.power_hour` at all. So
every one of these three — a per-user cached-desk confluence compute, a Postgres/Redis lotto read,
and a pure clock check — was wired up specifically to save the model a tool-call round-trip, and
then silently discarded before the model's own context was ever assembled. The model still had to
call `get_spx_confluence`/`get_lotto_state` itself on every SPX-desk question, which is the exact
round-trip the comments say this pre-population exists to avoid — i.e. a real latency/capability
regression hiding behind code that *looks* like it already solved the problem.

### Evidence (RED → GREEN)

Added `src/lib/largo/largo-live-feed.test.ts` (new file), testing `formatLargoLiveFeed` directly —
pure function, no DB/IO — with a combined fixture carrying `spx_structure` (a section that already
rendered) alongside all three missing fields populated, so a regression on any single one fails
loudly:

```
not ok 1 - formatLargoLiveFeed surfaces spx_confluence — RED before the fix, GREEN after
not ok 2 - formatLargoLiveFeed surfaces lotto_live
not ok 3 - formatLargoLiveFeed surfaces power_hour
ok 4 - formatLargoLiveFeed omits spx_confluence cleanly when it carries only an error
ok 5 - formatLargoLiveFeed omits lotto_live cleanly when unavailable
ok 6 - formatLargoLiveFeed omits power_hour when inactive/absent
# tests 6 / pass 3 / fail 3
```

(Tests 4-6 already passed pre-fix, confirming the test harness correctly distinguishes "field
present but erroring/unavailable" from "field present and should render" — the fix had to add
rendering without regressing the existing silent-skip-on-absence behavior.)

After the fix, restoring the render block: `# tests 6 / pass 6 / fail 0`. Ran alongside
`largo-terminal.test.ts` (22/22 combined) to confirm the existing mocked-module tests (which stub
`captureLargoLiveFeed`/`formatLargoLiveFeed` out entirely) are unaffected. `tsc --noEmit` clean
project-wide.

### Blast radius

- `src/lib/largo/largo-live-feed.ts` — the only file changed. Added three new render blocks to
  `formatLargoLiveFeed`, placed immediately after the existing `spx_structure` block (both are
  gated on the same `needsSpxDesk || scopeTicker === "SPX"` condition in `captureLargoLiveFeed`,
  so they belong together):
  - `spx_confluence`: a one-line summary (action/bias/score/grade/direction) plus a factor-count
    line (agreeing vs conflicting, with weighted conflict when present) — deliberately NOT a
    verbatim JSON dump, and deliberately NOT reusing `spxConfluenceNarrative` (that function reads
    a `confidence_omitted` marker `omitUncalibratedSpxConfidence` stamps on the TOOL-CALL path;
    `captureLargoLiveFeed` calls `computeSpxConfluence` directly without that boundary function, so
    reusing the narrative here would risk a different, unintended behavior change on a field this
    round did not touch). Confidence/rawScore are never rendered, matching the rest of this file's
    existing discipline of never surfacing fabricated certainty.
  - `lotto_live`: phase/direction/contract plus the headline/status line, skipped cleanly when
    `available === false` or the field carries only an `error`.
  - `power_hour`: a single flag line when `active`, silent otherwise.
  - Every new block follows the file's own established pattern exactly (`asObj`, `.filter(Boolean)
    .join(" · ")`, skip silently on error/absence) so it reads as native to the file, not bolted
    on.
- **Not touched**: `captureLargoLiveFeed` itself (the pre-fetch logic), `computeSpxConfluence`,
  `loadLottoRecord`, `get_spx_confluence`/`get_lotto_state` (the tool-call paths) — this is purely
  a rendering gap, not a data/computation bug, so nothing upstream needed to change.

### Fix rationale

The alternative — removing the three pre-fetches as dead code — was rejected: the comments make
clear the INTENT was always to surface them proactively (`"so Largo sees it"`,
`"ensures confluence is ALWAYS pre-populated"`), and the standing Ask Largo × Night Hawk mandate
(`CLAUDE.md`) explicitly wants more proactive surfacing, not less. Rendering them is the fix that
matches the code's own stated purpose; deleting the pre-fetch would just be removing the symptom
while leaving the actual gap (Largo still has no proactive confluence/lotto/power-hour context)
unaddressed. Kept each render terse (one or two lines) rather than a full dump, consistent with
every other section in this file, and never touched `capturedResults`/the post-hoc grounding path
since that consumer was never broken — only the model's *during-generation* view was missing these
three fields.
