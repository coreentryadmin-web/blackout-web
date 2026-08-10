import { test } from "node:test";
import assert from "node:assert/strict";
// The corpus builder lives with the audit harness (it is harness input, not runtime code) but is
// unit-tested here so CI covers it — a generator that silently produces 3 questions instead of 600
// would otherwise be discovered by reading a passing run summary and believing it.
// @ts-expect-error — .mjs harness module, no types
import { buildEvalCorpus, sampleCorpus, describeCorpus, CORPUS_TICKERS } from "../../../../scripts/audit/lib/largo-eval-corpus.mjs";

type Item = { id: string; tier: number; q: string; expect: Record<string, unknown> };

const corpus = buildEvalCorpus() as Item[];

test("the corpus is actually hundreds of questions, not a handful", () => {
  // The claim this file exists to make true. 19 hand-written questions cannot measure "Largo can
  // answer anything a member would ask"; this asserts the corpus is the size it says it is.
  assert.ok(corpus.length >= 250, `corpus was ${corpus.length}`);
  assert.equal(
    corpus.length,
    CORPUS_TICKERS.length * 14 + 25,
    "20 tickers × (10 answerable + 4 temporal) + 15 platform + 10 decline"
  );
});

test("every id is unique — a duplicate id silently overwrites a result", () => {
  const ids = corpus.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every item is well-formed", () => {
  for (const i of corpus) {
    assert.ok(i.q.trim().length > 0, i.id);
    assert.ok(!i.q.includes("{T}"), `unsubstituted template: ${i.q}`);
    assert.ok([1, 2, 3, 4].includes(i.tier), `${i.id} tier ${i.tier}`);
    assert.ok(i.expect, i.id);
  }
});

test("the must-decline tier exists and is non-trivial", () => {
  // This is the half that finds real bugs: fluently answering an unanswerable question is
  // invisible from the inside — confident prose, correct format, and only someone who knows the
  // data does not exist can tell.
  const declines = corpus.filter((i) => i.expect.shouldDecline);
  assert.ok(declines.length >= 10, `only ${declines.length} must-decline questions`);
  const kinds = new Set(declines.map((i) => i.expect.declineKind));
  for (const k of ["unknown_ticker", "prediction", "no_such_product", "no_data", "private"]) {
    assert.ok(kinds.has(k), `no must-decline coverage for ${k}`);
  }
});

test("temporal questions are marked so the runner can check the right thing", () => {
  // A temporal question may legitimately be declined — the window may not be retrievable. What it
  // must never do is answer with the PRESENT and present that as the answer about the past.
  const temporal = corpus.filter((i) => i.expect.temporal);
  assert.ok(temporal.length >= 40, `only ${temporal.length} temporal questions`);
  for (const t of temporal) assert.equal(t.tier, 3);
});

test("the corpus spans instruments, not just SPX", () => {
  // A hand-written bank clusters on the author's habits. This asserts the cross product actually
  // crossed.
  for (const ticker of CORPUS_TICKERS) {
    assert.ok(
      corpus.some((i) => (i.expect.mustMentionAny as string[] | undefined)?.includes(ticker)),
      `no question about ${ticker}`
    );
  }
});

test("sampling is deterministic — a failure has to be reproducible", () => {
  // "sample 40 seed 7 failed" must mean the same 40 questions tomorrow, or a flaky result cannot
  // be told apart from a fixed one.
  const a = sampleCorpus(corpus, 40, 7).map((i: Item) => i.id);
  const b = sampleCorpus(corpus, 40, 7).map((i: Item) => i.id);
  assert.deepEqual(a, b);
  const c = sampleCorpus(corpus, 40, 8).map((i: Item) => i.id);
  assert.notDeepEqual(a, c, "a different seed must select a different set");
});

test("sampling is stratified — a small sample never drops the must-decline tier", () => {
  // Tier 4 is the smallest and finds the most bugs, so uniform sampling would routinely drop it
  // and every small run would report a clean pass over questions that cannot fail that way.
  for (const n of [8, 20, 40, 100]) {
    for (const seed of [1, 2, 3]) {
      const s = sampleCorpus(corpus, n, seed) as Item[];
      assert.ok(s.length <= n, `sample of ${n} returned ${s.length}`);
      assert.ok(
        s.some((i) => i.expect.shouldDecline),
        `sample n=${n} seed=${seed} contained no must-decline question`
      );
    }
  }
});

test("sampling never invents or duplicates a question", () => {
  const s = sampleCorpus(corpus, 50, 3) as Item[];
  const ids = new Set(corpus.map((i) => i.id));
  assert.equal(new Set(s.map((i) => i.id)).size, s.length, "duplicate in sample");
  for (const i of s) assert.ok(ids.has(i.id), `${i.id} is not from the corpus`);
});

test("an out-of-range sample returns the whole corpus rather than throwing", () => {
  assert.equal((sampleCorpus(corpus, 0, 1) as Item[]).length, corpus.length);
  assert.equal((sampleCorpus(corpus, 99_999, 1) as Item[]).length, corpus.length);
  assert.equal((sampleCorpus(corpus, NaN, 1) as Item[]).length, corpus.length);
});

test("the run header describes what was actually covered", () => {
  // So nobody reads "40/40 pass" without knowing 40 of what. A coverage suite reported as an
  // accuracy suite is a misuse of it.
  const d = describeCorpus(sampleCorpus(corpus, 40, 5)) as {
    total: number;
    mustDecline: number;
    temporal: number;
    answerable: number;
    byTier: Record<string, number>;
  };
  assert.equal(d.total, d.answerable + d.mustDecline);
  assert.ok(d.mustDecline > 0);
  assert.ok(Object.keys(d.byTier).length >= 3);
});
