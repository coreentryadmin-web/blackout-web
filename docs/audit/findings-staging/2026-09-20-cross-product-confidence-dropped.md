> **kind:** FINDING

## `cross-product.ts` never REPORTED confidence — its own header comment says it should — PR TBD — fix/cross-product-confidence-dropped — 2026-09-20

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Area** | Ask Largo — cross-product integration layer |

**What was found:** `cross-product.ts`'s own file header states three design decisions. Decision 2
reads: *"DO NOT WEIGHT BY CONFIDENCE... Confidence is REPORTED, never multiplied by."* Tracing the
actual code: `joinProductSignals` never read `ProductSignal.confidence` (`product-read.ts`) at all —
not into `Camp`, not onto `CrossProductRead`, nowhere in the payload `get_cross_product_read` hands
back to the model. The "never multiplied by" half was correctly enforced (confidence never decided
`verdict`, `direction`, or camp sort order — it simply did not exist downstream to weight anything
with). The "REPORTED" half was silently false: a product that supplied a calibrated `confidence`
(score/basis/sample_size, per C6) had that information discarded the moment it entered the join, and
the system prompt's "Cross-product questions" section had nothing to tell the model to relay because
there was nothing in the payload to relay. This is the same class of gap as `unavailableSources`
never reaching `envelope.unavailableSources` (#4101, noted in CLAUDE.md's Ask Largo mandate history)
— an honestly-computed field that the shared layer never forwarded.

**Why this matters from a trader's perspective:** two products can agree on direction while
disagreeing sharply on how sure they are — "helix bullish, 0.9 confidence off n=200" reads very
differently from "helix bullish, no confidence given, thin sample." Before this fix, an `aligned`
verdict looked identical either way; a member (and the model answering them) had no way to tell a
strongly-calibrated consensus from a weakly-supported one, even though the data existed.

**Why this wasn't caught by existing tests:** the pre-existing test *"confidence does NOT decide the
outcome — the honest lane keeps its vote"* only asserts `verdict`/`direction` are unaffected by a
0.95 vs an honest omission — it never asserts anything about whether `confidence` appears anywhere
in the output, because at the time it was written nothing did. A test built to prove "confidence
doesn't win" cannot also catch "confidence is invisible" unless it separately asserts the field is
present — this is the same shape of blind spot the Swing-missing-from-`SOURCES` finding above
describes: a suite can't fail on a field it never had a reason to check for.

**What changed:**
- New `CampConfidence` type (`Confidence & { product: ProductId }`) and a `confidence:
  CampConfidence[]` field on `Camp` (`cross-product.ts`).
- `joinProductSignals` now pushes `{ product, ...signal.confidence }` onto the camp's `confidence`
  array whenever a reporting product supplied one (never fabricated — an omitting product simply
  contributes nothing to the array, same C6 discipline as everywhere else in this contract).
  `verdict`/`direction`/camp sort order are computed exactly as before — this list is populated
  strictly after those decisions are made, so it cannot influence them.
- `system-prompt.ts`'s "Cross-product questions" section gained one bullet telling the model it may
  relay a camp's confidence as color but may not let it override a split or promote a smaller camp —
  the same "report, never weight" instruction the code now actually makes possible to follow.

**Evidence:**
- New regression test *"confidence is REPORTED on the camp, not just withheld from the vote"*
  (`cross-product.test.ts`) — RED pre-fix (`git stash` on `cross-product.ts` + `system-prompt.ts`
  alone, test kept: `camp.confidence` is `undefined`, `deepEqual` against the expected array throws),
  GREEN post-fix (10/10 pass).
- `npx tsc --noEmit` → clean (no other file reads `Camp` or `CrossProductRead` — checked via
  repo-wide grep, `cross-product-read.ts` is the only importer and only spreads `...joined`).

**Blast radius:** `Camp` and `CrossProductRead` are read only by `cross-product-read.ts` (which
spreads the whole `joined` object into its payload unchanged) and this module's own test file —
confirmed via repo-wide grep, no other consumer exists. No adapter change was needed: every adapter
already either supplies `signal.confidence` when it can calibrate one or omits it — this fix only
stopped the join layer from throwing that field away.
