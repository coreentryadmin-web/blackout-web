import { test } from "node:test";
import assert from "node:assert/strict";
// Import the mapper from the side-effect-free module, NOT vector-wall-db.ts: the latter is
// `import "server-only"`, which THROWS on a plain `tsx --test` import ("cannot be imported from
// a Client Component"). vector-wall-db.ts re-exports rowToWallSample, so the runtime surface is
// identical — this just avoids tripping the server-only guard in the test runner.
import { rowToWallSample, sortWallSamplesForUpsert } from "./vector-wall-db-row";

// The DB is unreachable from this sandbox (raw TCP blocked), so we only exercise the PURE
// row → sample mapper. The persist/load functions are thin wrappers around dbQuery and are
// covered by the guard behaviour (return false / [] without DATABASE_URL) at the type level.

const GEX = { callWalls: [{ strike: 6800, pct: 10 }], putWalls: [{ strike: 6700, pct: 8 }] };
const VEX = { callWalls: [{ strike: 6820, pct: 5 }], putWalls: [{ strike: 6680, pct: 4 }] };

test("rowToWallSample coerces a bigint-as-string bucket_time to a number", () => {
  const sample = rowToWallSample({
    bucket_time: "1700000000",
    walls: GEX,
    gamma_flip: 6750,
    vex_walls: null,
    vex_flip: null,
  });
  assert.equal(typeof sample.time, "number");
  assert.equal(sample.time, 1700000000);
  assert.deepEqual(sample.walls, GEX);
  assert.equal(sample.gammaFlip, 6750);
});

test("rowToWallSample maps null gamma_flip / vex_walls / vex_flip to nulls", () => {
  const sample = rowToWallSample({
    bucket_time: 1700000015,
    walls: GEX,
    gamma_flip: null,
    vex_walls: null,
    vex_flip: null,
  });
  assert.equal(sample.gammaFlip, null);
  assert.equal(sample.vexWalls, null);
  assert.equal(sample.vexFlip, null);
});

test("rowToWallSample carries a populated vex row through", () => {
  const sample = rowToWallSample({
    bucket_time: 1700000030,
    walls: GEX,
    gamma_flip: 6750,
    vex_walls: VEX,
    vex_flip: 6710,
  });
  assert.deepEqual(sample.vexWalls, VEX);
  assert.equal(sample.vexFlip, 6710);
});

test("rowToWallSample parses jsonb handed back as a string", () => {
  const sample = rowToWallSample({
    bucket_time: 1700000045,
    walls: JSON.stringify(GEX),
    gamma_flip: null,
    vex_walls: JSON.stringify(VEX),
    vex_flip: null,
  });
  assert.deepEqual(sample.walls, GEX);
  assert.deepEqual(sample.vexWalls, VEX);
});

function row(ticker: string, sessionYmd: string, time: number) {
  return { ticker, sessionYmd, sample: { time } };
}

test(
  "sortWallSamplesForUpsert produces the SAME row order regardless of input order — the deadlock fix",
  () => {
    // Two "replicas" hand this the same rows in different (independent) orders — the whole point
    // is that both must produce an IDENTICAL output order, or the deadlock this exists to prevent
    // can still happen. Confirmed live 2026-09-01: 4 `deadlock detected` errors on the multi-row
    // INSERT this feeds, over a ~29h window in production — see this function's own doc comment.
    const replicaA = [row("QQQ", "2026-09-01", 200), row("SPX", "2026-09-01", 100), row("SPX", "2026-09-01", 50)];
    const replicaB = [row("SPX", "2026-09-01", 50), row("SPX", "2026-09-01", 100), row("QQQ", "2026-09-01", 200)];

    const sortedA = sortWallSamplesForUpsert(replicaA);
    const sortedB = sortWallSamplesForUpsert(replicaB);

    assert.deepEqual(sortedA, sortedB);
    // And the order is the expected (ticker, session_ymd, bucket_time) order, not just "some
    // consistent order" — QQQ < SPX alphabetically, and within SPX the earlier bucket_time first.
    assert.deepEqual(
      sortedA.map((r) => `${r.ticker}:${r.sample.time}`),
      ["QQQ:200", "SPX:50", "SPX:100"]
    );
  }
);

test("sortWallSamplesForUpsert does not mutate its input array", () => {
  const rows = [row("SPX", "2026-09-01", 200), row("QQQ", "2026-09-01", 100)];
  const original = [...rows];
  sortWallSamplesForUpsert(rows);
  assert.deepEqual(rows, original);
});

test("sortWallSamplesForUpsert orders session_ymd before bucket_time within the same ticker", () => {
  const rows = [row("SPX", "2026-09-02", 1), row("SPX", "2026-09-01", 999)];
  const sorted = sortWallSamplesForUpsert(rows);
  assert.deepEqual(
    sorted.map((r) => r.sessionYmd),
    ["2026-09-01", "2026-09-02"]
  );
});
