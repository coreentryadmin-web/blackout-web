## 2026-10-08 — [FINDING, largo-swing] A fresh GEX matrix with no gamma-flip crossing was indistinguishable from a missing fetch — the computed `flip_reason` never reached `envelope.unavailableSources` — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong number served — the omission itself was honest-looking, which is exactly the C3 failure mode: a consumer that cannot tell "no data" from "no signal" will report absence as a finding) |
| **Component** | `src/lib/swing/play-brief-absence.ts` (`collectBriefUnavailableSources`) |
| **PR** | fix/largo-swing-gamma-flip-absence |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, deep-diving `GET /api/market/swing/play-brief` for fresh tickers (CRDU, LQDA open; MSFT, INTC closed) against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s C3 absence point |

### Root cause

`src/lib/providers/gex-positioning.ts`'s `GexPositioning` type already carries `flip_reason?:
string | null` — `'insufficient_data' | 'net_short_everywhere' | 'net_long_everywhere' |
'crossings_far'`, omitted only when `flip` is itself available — specifically so a caller can tell
a genuine computation gap (`insufficient_data`, `crossings_far`) apart from an honest, real
market-structure fact (`net_short_everywhere`/`net_long_everywhere`: the book never crosses zero
gamma because dealers sit on one side at every strike). That file's own doc comment names this
directly: *"no gamma flip, dealers net short at EVERY strike"* is itself a finding, not an absence
of one.

`play-brief.ts`'s `levelsFromContext` (the swing play-brief's envelope builder) only ever reads
`gex?.flip` when building the "gamma flip" `levels[]` entry, and silently omits the entry whenever
it is `null` — collapsing both cases (a real data gap vs. a real "no flip exists" market read) into
the exact same silence `flip_reason` was built to distinguish. Nothing in
`envelope.unavailableSources` mentioned it either, so neither the structured `levels[]` array nor
the absence-disclosure channel gave a reader (or the model) any way to tell "we don't have it yet"
from "there genuinely isn't one, which is itself worth knowing."

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:INTC&ticker=INTC&positionId=50&status=CLOSED`
(2026-10-08, ~16:16 ET), compared against a sibling `MSFT` read in the **same cycle**:

- INTC: `envelope.levels` carried `call wall` (120), `put wall` (100), `spot` (107.31), `GEX king`
  (120) — all `freshness: "live"`, i.e. the GEX matrix was fresh, not stale — but **no `gamma flip`
  entry at all**, and `envelope.unavailableSources` was `[]`.
- MSFT, same cycle: `envelope.levels` carried the identical four labels **plus** `gamma flip:
  507.71`.

The two reads were structurally indistinguishable from "INTC's gamma flip fetch failed" — the only
way to tell they actually meant different things (INTC's GEX posture narrative separately said
"dealers short gamma", implying the real reason was a structural `net_short_everywhere` read, not
a fetch gap) was to read the free-text narrative and infer it, which is exactly the guessing C3
exists to remove.

### Fix rationale

Added `collectGexFlipAbsence()` to `play-brief-absence.ts`, following the exact shape of the
sibling `collectGexStalenessAbsence()` already in the same file: when the GEX matrix is fresh (not
already covered by the existing staleness chip — piling a second chip on a stale read would
duplicate rather than add information) and `flip` is `null`, look up the documented `flip_reason`
in a small disclosure table and push an honest `unavailableSources` entry:

- `net_short_everywhere` / `net_long_everywhere` → disclosed as a real structural finding,
  `retryable: false` (a refetch will not produce a flip that structurally does not exist).
- `insufficient_data` / `crossings_far` → disclosed as a genuine gap, `retryable: true`.
- Any other/future `flip_reason` code → **not** surfaced, rather than guessed at (C6: omit a
  field a product cannot calibrate, never fabricate one).

Left unchanged: `levelsFromContext`'s own `levels[]` builder (still correctly omits a `null` flip
level — adding a fabricated numeric entry there would be worse), and every other `unavailableSources`
check in the file (none of them touch GEX flip specifically). Single-issue, single-file fix plus its
test file.

### Regression test (RED → GREEN, git-stash proven)

Added five cases to `src/lib/swing/play-brief-absence.test.ts`:
1. fresh matrix, `flip_reason: "net_short_everywhere"` → chip surfaces, `retryable: false`.
2. fresh matrix, `flip_reason: "insufficient_data"` → chip surfaces, `retryable: true`.
3. fresh matrix, an unrecognized `flip_reason` → no chip (no fabrication).
4. an already-stale matrix with the same `net_short_everywhere` reason → only the existing `"GEX
   matrix"` staleness chip fires, no second flip-specific chip.
5. a real, non-null `flip` value → no chip (the common case is untouched).

`git stash` of `src/lib/swing/play-brief-absence.ts` alone (test file kept): **2 of 83 tests in the
file failed** (cases 1 and 2 — cases 3-5 pass trivially either way since they assert absence, not
presence, of the new chip, so they are guard-rails rather than RED-triggering). Restoring the fix:
**83/83 pass**. Full suite: 15832 pass / 0 fail / 3 skip (Node 20). `tsc --noEmit` clean.

### Blast radius

`collectGexFlipAbsence` is additive and scoped to one call site
(`collectBriefUnavailableSources`'s existing `!isNotLive` GEX block, right beside the staleness
check it depends on for ordering). No other reader of `GexPositioning.flip`/`flip_reason` exists
in the swing lane today (`levelsFromContext`, the only other consumer of `gex?.flip`, is
deliberately left as-is — see Fix rationale). Not touched: Vector's own `gamma_flip` absence
section (`VECTOR_SECTION_LABELS`), which is a different upstream (`vector_full_state`) and already
has its own, pre-existing absence handling.
