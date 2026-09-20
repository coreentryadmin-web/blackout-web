## Vector "live" freshness tag is COMPUTE-recency only — no MARKET-SESSION disclosure — FIXED (partial, scoped)

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED (Vector-state half only — see "What remains open" below) |
| **Area** | `src/lib/bie/vector-state-freshness.ts` (`describeVectorFreshness`), consumed by `product-reads.ts`, `vector-full-state.ts`, `vector-desk-brief.ts`, `play-brief.ts`, `play-brief-absence.ts`, `play-brief-narrative.ts` |

### How found

Raised repeatedly across several prior cycles on PR #4076 as a cross-desk design question,
never scoped down to a concrete fix until this cycle. Live repro this cycle (PR #4076 comment
5749904631, 2026-09-20 12:49 UTC): a Sunday `GET /api/market/swing/play-brief` read (market
closed since Friday's close, ~40+ hours prior) returned `evidence[]`/`levels[]` entries stamped
`"source": "Vector", "asOf": "2026-09-20 08:47 ET", "freshness": "live"` — the compute genuinely
ran seconds before the read, but nothing in the payload disclosed that the market itself had not
ticked in over 40 hours.

### Root cause

`describeVectorFreshness` (`vector-state-freshness.ts`) classifies `freshness` purely as
`nowMs - observedMs` against `freshnessFromAgeMs`'s 60s/600s boundaries (`answer-envelope.ts`).
That is a correct measure of COMPUTE recency, but it is the only freshness signal the function
ships — there was no MARKET-SESSION-recency field at all. A weekend/holiday self-warm (any
Largo/swing reader that misses the 15-minute Redis cache re-runs `computeVectorFullState` on
demand — see the module's own long-standing doc comment) genuinely computes a fresh number *from*
Friday's closing tape, so `freshness: "live"` is technically correct about the compute while being
silent about — and easily misread as implying — a live market tick.

### Investigation: is this genuinely shared, or narrower than assumed?

Both, in different halves — which is why this PR ships one half and scopes the other rather than
guessing at a single fix for everything the original design question named:

- **`describeVectorFreshness` itself IS genuinely a shared primitive** (grep confirms live import
  sites in `product-reads.ts`, `vector-full-state.ts`, `vector-desk-brief.ts`, `play-brief.ts`,
  `play-brief-absence.ts`, `play-brief-narrative.ts` — Largo tool answers, Vector's own desk brief,
  and swing's play-brief all route through it), so widening its EXISTING `freshness` scale, or
  changing what any of those consumers receive for `.freshness`, would need the cross-desk care the
  standing policy asks for. This PR does not touch that.
- **But the GAP itself — no market-session field at all — is a narrow, additive omission** fixable
  in the same file without touching `freshnessFromAgeMs`, without changing the meaning or value of
  `.freshness` for any existing consumer, and without a schema/cache change. That's what this PR
  ships.
- **The GEX-matrix half of the live symptom is a SEPARATE, unrelated mechanism** and is explicitly
  NOT touched here — see "What remains open."

### Fix

Added two new, purely additive fields to `VectorFreshnessBlock`/`describeVectorFreshness`'s return
value, reusing the existing shared `etSessionFacts()` (`src/lib/et-session-facts.ts` — already
holiday-aware via `isTradingDayEt`, already used elsewhere, so this is a delegation, not a new
market-phase derivation):

- `market_session: MarketPhase` — `OPEN | PRE-MARKET | AFTER-HOURS | CLOSED`, evaluated at the READ
  instant, present on every branch (including the `unknown`/clock-skew branches).
- `market_session_note: string | null` — fires ONLY for the misleading combination this finding is
  about: `freshness` is `"live"` or `"recent"` (compute genuinely fresh) AND `market_session` is
  `"CLOSED"`. Null whenever `freshness` is already `"stale"`/`"unknown"` (that verdict's own note
  already covers it — no redundant second disclosure) or the market is genuinely open.

Per the Largo product contract's own ADDITIVE rule (`docs/audit/LARGO-PRODUCT-CONTRACT.md`): the
new fields sit ALONGSIDE `freshness`, they do not reinterpret or replace it. `freshness` still
answers "how old is this compute"; `market_session`/`market_session_note` answer the orthogonal
"is the market this compute describes currently open." A consumer that wants "can I trust this as
the current tape" now has both signals to check instead of only the misleading one.

### Blast radius

One file (`vector-state-freshness.ts`) + its test file. Every existing field on
`VectorFreshnessBlock` is unchanged in name, type, and value — the two new fields are additive, so
every current consumer (listed above) compiles and behaves identically; none of them read the new
fields yet (see "What remains open"), so this PR changes no visible behavior on its own — it lands
the primitive so a follow-up can wire it in without touching this file again.

### What remains open (scoped on PR #4076, not fixed here)

1. **Wiring `market_session_note` into the actual swing evidence array.** `play-brief.ts`'s
   `vectorFreshness()` helper calls `describeVectorFreshness(...)` but only extracts `.freshness`,
   discarding the new fields — so the live symptom in the original repro (evidence entries showing
   bare `"freshness": "live"` with no disclosure) is not yet visibly fixed by this PR alone. That
   wiring is swing-scoped (`play-brief.ts`) and safe to do as a fast follow-up.
2. **The GEX-matrix half is a completely separate, untouched mechanism.** `gexFreshness()`
   (`play-brief.ts`) and `gexMatrixStale()`/`gexMatrixAgeMs()` (`play-brief-absence.ts`) never call
   `describeVectorFreshness` at all — they classify off `gexMatrixAgeMs` (itself sourced from
   `polygon-options-gex.ts`'s `calculatedAt = new Date(now).toISOString()`, a pure wall-clock
   compute stamp) against the shared `GEX_MATRIX_STALE_MS` (2 minutes) constant directly. Giving
   GEX the same market-session disclosure needs either (a) a parallel `market_session`/
   `market_session_note` computation at its own call site (cheap, but a second copy of the same
   logic — the `describeVectorFreshness` module's own doc explicitly warns against a second scale/
   implementation forking from the first), or (b) a shared helper both `gexFreshness` and
   `vectorFreshness` call. `polygon-options-gex.ts` is used broadly across desks, so which shape is
   right is exactly the kind of design call this repo's cross-PR-ordering discipline says to scope
   with Cursor rather than guess at solo.

Both are named explicitly in a follow-up comment on PR #4076 so a future cycle (this session's or
Cursor's) has the precise remaining scope instead of re-deriving it from scratch.

### Verification

New tests in `vector-state-freshness.test.ts`: a compute-fresh state on a CLOSED market carries
the note; a compute-fresh state on an OPEN market carries none; a market HOLIDAY (Thanksgiving,
a Thursday) reads CLOSED via `etSessionFacts`'s holiday calendar, not just weekends; a genuinely
STALE compute suppresses the redundant note; the note is suppressed on unparseable/clock-skewed
reads. RED→GREEN proven via `git stash` on the source file alone (tests unchanged): 5 failures
without the fix, 0 with it. Full `vector-state-freshness.test.ts` suite: 24/24 pass. `npx tsc
--noEmit` clean. Full `npm test` run separately (Node 20) before merge.
