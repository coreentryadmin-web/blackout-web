import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  classifyPixel,
  clusterBeadPixels,
  summarizeBeads,
  verdictForTicker,
} = require("./bead-pixel-eval.cjs");

const W = 240;
const H = 160;

/** Synthetic RGBA canvas on a near-black chart ground. */
function canvas(): Uint8Array {
  const buf = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    buf[i * 4] = 5;
    buf[i * 4 + 1] = 5;
    buf[i * 4 + 2] = 8;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

/** Paint a filled disc. `lumScale` stands in for the rail's fill alpha over a black ground. */
function disc(
  buf: Uint8Array,
  cx: number,
  cy: number,
  r: number,
  side: "call" | "put",
  lumScale = 1
) {
  const base = side === "call" ? [30, 220, 240] : [240, 60, 70];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const o = (y * W + x) * 4;
      buf[o] = Math.round(base[0]! * lumScale);
      buf[o + 1] = Math.round(base[1]! * lumScale);
      buf[o + 2] = Math.round(base[2]! * lumScale);
      buf[o + 3] = 255;
    }
  }
}

test("classifyPixel separates beads from ground, chrome and candles", () => {
  assert.equal(classifyPixel(5, 5, 8, 255), null, "chart ground");
  assert.equal(classifyPixel(160, 160, 165, 255), null, "grey axis text");
  assert.equal(classifyPixel(30, 220, 240, 255), "call", "cyan call bead");
  assert.equal(classifyPixel(240, 60, 70, 255), "put", "red put bead");
  // A green candle body is green-dominant with LOW blue — it must not read as a call bead, or the
  // size distribution gets measured off the tape instead of the rail.
  assert.equal(classifyPixel(20, 200, 60, 255), null, "green candle body");
  assert.equal(classifyPixel(30, 220, 240, 10), null, "fully transparent");
});

test("clustering finds each disc once and recovers its radius", () => {
  const buf = canvas();
  disc(buf, 40, 40, 8, "call");
  disc(buf, 120, 40, 4, "call");
  disc(buf, 200, 120, 6, "put");
  const clusters = clusterBeadPixels(buf, W, H, 4);
  assert.equal(clusters.length, 3);
  const radii = clusters.map((c: { radius: number }) => Math.round(c.radius)).sort();
  assert.deepEqual(radii, [4, 6, 8]);
  assert.equal(clusters.filter((c: { side: string }) => c.side === "put").length, 1);
});

test("long thin runs (price lines, wicks) are not counted as beads", () => {
  const buf = canvas();
  for (let x = 10; x < 230; x++) {
    const o = (80 * W + x) * 4;
    buf[o] = 30;
    buf[o + 1] = 220;
    buf[o + 2] = 240;
    buf[o + 3] = 255;
  }
  assert.equal(clusterBeadPixels(buf, W, H, 4).length, 0);
});

test("a varied rail reads GREEN", () => {
  const buf = canvas();
  // Sizes 3..9 and fills from dim to full — a healthy point-in-time-weighted rail.
  const sizes = [3, 4, 5, 6, 7, 8, 9, 3, 5, 7, 4, 8, 6, 9];
  sizes.forEach((r, i) => {
    const side = i % 2 === 0 ? "call" : "put";
    disc(buf, 12 + (i % 7) * 32, 20 + Math.floor(i / 7) * 60, r, side, 0.35 + (r / 9) * 0.65);
  });
  const s = summarizeBeads(clusterBeadPixels(buf, W, H, 4));
  const v = verdictForTicker(s);
  assert.equal(v.verdict, "GREEN", `${JSON.stringify(s)} ${JSON.stringify(v)}`);
  assert.ok(s.radiusRatio >= 1.4);
  assert.ok(s.lumSpread >= 18);
});

test("the member's reported failure — same size, same contrast — reads RED", () => {
  const buf = canvas();
  for (let i = 0; i < 16; i++) {
    disc(buf, 12 + (i % 8) * 28, 30 + Math.floor(i / 8) * 60, 5, i % 2 ? "call" : "put", 1);
  }
  const v = verdictForTicker(summarizeBeads(clusterBeadPixels(buf, W, H, 4)));
  assert.equal(v.verdict, "RED");
  assert.ok(v.notes.some((n: string) => n.includes("size is flat")));
  assert.ok(v.notes.some((n: string) => n.includes("contrast is flat")), JSON.stringify(v.notes));
});

test("hue difference between sides is not mistaken for contrast", () => {
  // The metric's original form measured luminance spread across ALL beads. The call palette (cyan)
  // is far brighter than the put palette (red) at identical alpha, so a rail of fully-opaque beads
  // reported a large spread purely from hue — which would have passed this audit on exactly the
  // flat rail the member photographed. Spread is now measured WITHIN each side.
  const buf = canvas();
  for (let i = 0; i < 16; i++) {
    disc(buf, 12 + (i % 8) * 28, 30 + Math.floor(i / 8) * 60, 5, i % 2 ? "call" : "put", 1);
  }
  assert.equal(summarizeBeads(clusterBeadPixels(buf, W, H, 4)).lumSpread, 0);
});

test("the #2310 failure — drawn but invisible — reads RED", () => {
  const buf = canvas();
  // Sub-pixel dots with varied fills: contrast varies, size does not, and the median is unreadable.
  for (let i = 0; i < 20; i++) {
    disc(buf, 10 + i * 11, 40 + (i % 3) * 30, 1.1, i % 2 ? "call" : "put", 0.4 + (i % 5) * 0.15);
  }
  const s = summarizeBeads(clusterBeadPixels(buf, W, H, 4));
  const v = verdictForTicker(s);
  assert.equal(v.verdict, "RED");
  assert.ok(v.notes.some((n: string) => n.includes("readable floor")));
});

test("an empty rail is RED with the count, not a crash", () => {
  const v = verdictForTicker(summarizeBeads(clusterBeadPixels(canvas(), W, H, 4)));
  assert.equal(v.verdict, "RED");
  assert.match(v.reason as string, /only 0 beads/);
});

test("a one-sided rail is AMBER, not RED — a session can genuinely be one-sided", () => {
  const buf = canvas();
  const sizes = [3, 4, 5, 6, 7, 8, 9, 3, 5, 7, 4, 8, 6, 9];
  sizes.forEach((r, i) => {
    disc(buf, 12 + (i % 7) * 32, 20 + Math.floor(i / 7) * 60, r, "call", 0.35 + (r / 9) * 0.65);
  });
  const v = verdictForTicker(summarizeBeads(clusterBeadPixels(buf, W, H, 4)));
  assert.equal(v.verdict, "AMBER");
  assert.ok(v.notes.some((n: string) => n.includes("one-sided")));
});
