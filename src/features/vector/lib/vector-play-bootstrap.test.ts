import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapVectorPlayEmit } from "./vector-play-bootstrap";

test("bootstrapVectorPlayEmit: builds play from seed walls before chart/SSE", () => {
  const emit = bootstrapVectorPlayEmit({
    ticker: "TSLA",
    horizon: "0dte",
    timeframeMin: 3,
    spot: 354,
    walls: {
      callWalls: [{ strike: 355, gex: 1e9, pct: 0.5 }],
      putWalls: [{ strike: 352.5, gex: 8e8, pct: -0.4 }],
    },
    gammaFlip: 352.53,
  });
  assert.ok(emit?.play);
  assert.match(emit!.play.headline, /355|352|fade|pivot|momentum/i);
  assert.equal(emit!.spot, 354);
});

test("bootstrapVectorPlayEmit: null without spot", () => {
  assert.equal(
    bootstrapVectorPlayEmit({
      ticker: "SOFI",
      horizon: "0dte",
      timeframeMin: 3,
      spot: null,
      walls: { callWalls: [{ strike: 19, gex: 1, pct: 1 }], putWalls: [] },
      gammaFlip: 18.7,
    }),
    null
  );
});
