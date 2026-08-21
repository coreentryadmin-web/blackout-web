import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_COHORT_PEERS,
  buildSectorCohort,
  classifySic,
  describeCohortPosition,
  orderTickersForClassification,
} from "./meridian-sector-core";

test("classifySic reads the 2-digit major group and names it", () => {
  const c = classifySic(3674, "SEMICONDUCTORS & RELATED DEVICES");
  assert.equal(c.majorGroup, "36");
  assert.equal(c.label, "Semis & Electronics");
  assert.equal(c.sicCode, "3674");
  assert.equal(c.sicDescription, "SEMICONDUCTORS & RELATED DEVICES");
});

test("classifySic left-pads short codes instead of truncating", () => {
  // SIC 100 is agricultural production. Reading the first two characters of the RAW string
  // would yield "10" — Metals & Mining — and file a farm with a copper miner.
  const c = classifySic("100");
  assert.equal(c.sicCode, "0100");
  assert.equal(c.majorGroup, "01");
  assert.equal(c.label, "Agriculture");
});

test("classifySic falls back to the SIC division for an unnamed major group", () => {
  // 38 is named; 43 is not in the label table but sits inside Transport & Utilities.
  assert.equal(classifySic(3826).label, "Instruments & Medical Devices");
  const fallback = classifySic(4311);
  assert.equal(fallback.majorGroup, "43");
  assert.equal(fallback.label, "Transport & Utilities");
});

test("classifySic returns nulls rather than guessing on unusable input", () => {
  for (const bad of [null, undefined, "", "N/A", "123456"]) {
    const c = classifySic(bad);
    assert.equal(c.majorGroup, null, `expected no group for ${String(bad)}`);
    assert.equal(c.label, null);
  }
});

const cls = classifySic(3674, "SEMICONDUCTORS & RELATED DEVICES");

test("a cohort below the peer floor reports members but NO distribution", () => {
  const cohort = buildSectorCohort({
    subject: "NVDA",
    subjectValue: 7.2,
    classification: cls,
    peers: [
      { ticker: "AVGO", value: 5.1 },
      { ticker: "AMD", value: 6.4 },
    ],
  });
  assert.ok(cohort);
  assert.equal(cohort.distribution, null);
  assert.match(cohort.insufficientReason!, /2 peers/);
  // The members are still listed — "who are the peers" is answerable even when "where do you
  // rank" is not.
  assert.equal(cohort.members.length, 3);
});

test("the subject is excluded from its own distribution", () => {
  const peers = [
    { ticker: "A", value: 2 },
    { ticker: "B", value: 2 },
    { ticker: "C", value: 2 },
    { ticker: "D", value: 2 },
  ];
  const cohort = buildSectorCohort({
    subject: "SUBJ",
    subjectValue: 100,
    classification: cls,
    peers,
  })!;
  assert.equal(cohort.distribution!.peers, peers.length);
  // If the subject leaked in, the max would be 100 and the median would be dragged upward.
  assert.equal(cohort.distribution!.max, 2);
  assert.equal(cohort.distribution!.median, 2);
  assert.equal(cohort.distribution!.percentile, 1);
});

test("a duplicate of the subject in the peer list is not counted twice", () => {
  const cohort = buildSectorCohort({
    subject: "nvda",
    subjectValue: 7,
    classification: cls,
    peers: [
      { ticker: "NVDA", value: 7 },
      { ticker: "A", value: 1 },
      { ticker: "B", value: 2 },
      { ticker: "C", value: 3 },
      { ticker: "D", value: 4 },
    ],
  })!;
  assert.equal(cohort.distribution!.peers, 4);
  assert.equal(cohort.members.length, 5);
});

test("quantiles interpolate and the percentile is the share of peers at or below", () => {
  const cohort = buildSectorCohort({
    subject: "SUBJ",
    subjectValue: 3,
    classification: cls,
    peers: [
      { ticker: "A", value: 1 },
      { ticker: "B", value: 2 },
      { ticker: "C", value: 3 },
      { ticker: "D", value: 4 },
      { ticker: "E", value: 5 },
    ],
  })!;
  const d = cohort.distribution!;
  assert.equal(d.median, 3);
  assert.equal(d.p25, 2);
  assert.equal(d.p75, 4);
  assert.equal(d.min, 1);
  assert.equal(d.max, 5);
  assert.equal(d.percentile, 0.6); // 1,2,3 of 5 are <= 3
});

test("peers with no value are carried as members but never counted as n", () => {
  const cohort = buildSectorCohort({
    subject: "SUBJ",
    subjectValue: 5,
    classification: cls,
    peers: [
      { ticker: "A", value: 1 },
      { ticker: "B", value: 2 },
      { ticker: "C", value: 3 },
      { ticker: "D", value: 4 },
      { ticker: "E", value: null },
    ],
  })!;
  assert.equal(cohort.distribution!.peers, 4);
  assert.equal(cohort.members.length, 6);
});

test("the peer floor is what it says it is", () => {
  const mk = (n: number) =>
    buildSectorCohort({
      subject: "SUBJ",
      subjectValue: 1,
      classification: cls,
      peers: Array.from({ length: n }, (_, i) => ({ ticker: `P${i}`, value: i + 1 })),
    })!;
  assert.equal(mk(MIN_COHORT_PEERS - 1).distribution, null);
  assert.ok(mk(MIN_COHORT_PEERS).distribution);
});

test("an unclassifiable name yields no cohort at all", () => {
  assert.equal(
    buildSectorCohort({
      subject: "X",
      subjectValue: 1,
      classification: classifySic(null),
      peers: [],
    }),
    null
  );
});

test("describeCohortPosition says 'in line' inside the IQR and never invents a stance", () => {
  const peers = [1, 2, 3, 4, 5].map((v, i) => ({ ticker: `P${i}`, value: v }));
  const mid = buildSectorCohort({ subject: "S", subjectValue: 3, classification: cls, peers });
  assert.match(describeCohortPosition(mid, { unit: "%" })!, /in line with/);

  const rich = buildSectorCohort({ subject: "S", subjectValue: 9, classification: cls, peers });
  assert.match(describeCohortPosition(rich, { unit: "%" })!, /rich to/);

  const cheap = buildSectorCohort({ subject: "S", subjectValue: 0.5, classification: cls, peers });
  assert.match(describeCohortPosition(cheap, { unit: "%" })!, /cheap to/);

  // No subject value: report the cohort, claim nothing about where this name sits.
  const blind = buildSectorCohort({ subject: "S", subjectValue: null, classification: cls, peers });
  const line = describeCohortPosition(blind, { unit: "%" })!;
  assert.match(line, /median 3%/);
  assert.doesNotMatch(line, /rich|cheap|in line/);
});

test("describeCohortPosition surfaces the too-few-peers reason rather than a bare label", () => {
  const thin = buildSectorCohort({
    subject: "S",
    subjectValue: 1,
    classification: cls,
    peers: [{ ticker: "A", value: 1 }],
  });
  assert.match(describeCohortPosition(thin)!, /too few to rank against/);
});

test("orderTickersForClassification puts names WITH a comparable value first", () => {
  // The lane is bigger than the lookup budget, so this ordering decides which names get
  // classified at all. Measured live: 199 rows, 120-lookup cap, only 22 with a numeric move.
  const rows = [
    { ticker: "A", em: null },
    { ticker: "B", em: 5 },
    { ticker: "C", em: null },
    { ticker: "D", em: 7 },
  ];
  assert.deepEqual(
    orderTickersForClassification(rows, (r) => r.em != null, (r) => r.ticker),
    ["B", "D", "A", "C"]
  );
});

test("orderTickersForClassification is a STABLE partition, not a re-sort", () => {
  // Within each half the caller's order survives, so the calendar still breaks ties and the
  // output is deterministic for a given input.
  const rows = [
    { ticker: "Z", em: 1 },
    { ticker: "Y", em: 2 },
    { ticker: "X", em: null },
    { ticker: "W", em: null },
  ];
  assert.deepEqual(
    orderTickersForClassification(rows, (r) => r.em != null, (r) => r.ticker),
    ["Z", "Y", "X", "W"]
  );
});

test("orderTickersForClassification drops unusable tickers and tolerates nullish input", () => {
  const rows = [
    { ticker: "  ", em: 1 },
    { ticker: "A", em: 1 },
    { ticker: "", em: null },
  ];
  assert.deepEqual(orderTickersForClassification(rows, (r) => r.em != null, (r) => r.ticker), ["A"]);
  assert.deepEqual(orderTickersForClassification(null, () => true, () => "X"), []);
  assert.deepEqual(orderTickersForClassification(undefined, () => true, () => "X"), []);
});

test("orderTickersForClassification never loses a usable name", () => {
  // The budget may cut the tail, but this function must not: reordering is not filtering.
  const rows = Array.from({ length: 50 }, (_, i) => ({ ticker: `T${i}`, em: i % 3 === 0 ? i : null }));
  const out = orderTickersForClassification(rows, (r) => r.em != null, (r) => r.ticker);
  assert.equal(out.length, 50);
  assert.equal(new Set(out).size, 50);
});
