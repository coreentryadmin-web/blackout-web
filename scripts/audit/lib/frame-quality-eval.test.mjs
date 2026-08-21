import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aspectVerdict,
  backgroundLuma,
  gridEmptiness,
  inkRatio,
  largestEmptyBand,
  scoreFrame,
  timelineLegibility,
} from "./frame-quality-eval.cjs";

/** Synthetic RGBA canvas — the right answer is known by construction. */
function canvas(w, h, bg = 10) {
  const b = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    b[i * 4] = bg; b[i * 4 + 1] = bg; b[i * 4 + 2] = bg; b[i * 4 + 3] = 255;
  }
  return b;
}
function fill(buf, w, x0, y0, x1, y1, v) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * w + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
  }
}
/** Vertical stripes of period `period` — a stand-in for text at a given stroke width. */
function stripes(buf, w, x0, y0, x1, y1, period, v = 230) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (Math.floor(x / period) % 2 === 0) continue;
      const i = (y * w + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
  }
}

describe("backgroundLuma — the canvas, not the mean", () => {
  it("finds the dark canvas under sparse bright content", () => {
    // The mean would be dragged up by exactly the pixels that matter.
    const w = 400, h = 200, b = canvas(w, h, 8);
    fill(b, w, 0, 0, 400, 20, 250);
    assert.ok(backgroundLuma(b, w, h) < 20);
  });
});

describe("inkRatio", () => {
  it("reads ~0 on an empty canvas", () => {
    assert.ok(inkRatio(canvas(200, 200), 200, 200) < 0.01);
  });
  it("reads ~half when half the frame is filled", () => {
    const w = 200, h = 200, b = canvas(w, h);
    fill(b, w, 0, 0, 200, 100, 200);
    assert.ok(Math.abs(inkRatio(b, w, h) - 0.5) < 0.02);
  });
});

describe("largestEmptyBand", () => {
  it("measures a dead band spanning half the height", () => {
    const w = 200, h = 200, b = canvas(w, h);
    fill(b, w, 0, 0, 200, 100, 200);
    const band = largestEmptyBand(b, w, h);
    assert.ok(Math.abs(band.fraction - 0.5) < 0.05, `got ${band.fraction}`);
  });
});

describe("gridEmptiness — catches a dead REGION a row scan cannot", () => {
  it("flags a frame busy on the left and dead on the right", () => {
    // This is the Night Hawk shape: populated rail, empty "select a play" panel. Every ROW has
    // content, so a row scan reports ~0 dead — the grid is what sees it.
    const w = 480, h = 240, b = canvas(w, h);
    stripes(b, w, 0, 0, 240, 240, 3);
    assert.ok(largestEmptyBand(b, w, h).fraction < 0.05, "row scan should see nothing");
    assert.ok(gridEmptiness(b, w, h) > 0.4, `grid should see ~half: got ${gridEmptiness(b, w, h)}`);
  });
});

describe("timelineLegibility — the metric that was broken first time", () => {
  it("scores COARSE content high — nothing to lose in a downscale", () => {
    const w = 2400, h = 800, b = canvas(w, h);
    fill(b, w, 100, 100, 2300, 700, 220);
    assert.ok(timelineLegibility(b, w, h) > 0.9);
  });

  it("scores FINE content low — 1px strokes do not survive a 4x downscale", () => {
    const w = 2400, h = 800, b = canvas(w, h);
    stripes(b, w, 0, 0, 2400, 800, 1);
    const fine = timelineLegibility(b, w, h);
    // A 1px stripe pattern box-downscaled 4x averages to flat grey, so the reconstruction error is
    // half the contrast and the score lands at ~0.50 by construction. That is BELOW the 0.55
    // reject threshold, which is the property that matters — the exact value is arithmetic, not a
    // tuning choice.
    assert.ok(fine <= 0.52, `fine detail should collapse, got ${fine}`);
  });

  it("ranks coarse above fine — the property the first version failed to have", () => {
    // v1 normalised by the scale factor, which cancelled the signal and returned 1.00 for
    // everything. A metric that passes every input is broken, not lenient.
    const w = 2400, h = 800;
    const coarse = canvas(w, h); stripes(coarse, w, 0, 0, w, h, 24);
    const fine = canvas(w, h); stripes(fine, w, 0, 0, w, h, 1);
    assert.ok(timelineLegibility(coarse, w, h) > timelineLegibility(fine, w, h) + 0.2);
  });

  it("returns 1 for a frame already at timeline width", () => {
    assert.equal(timelineLegibility(canvas(400, 300), 400, 300), 1);
  });
});

describe("aspectVerdict", () => {
  it("calls a 20:1 strip a sliver, not 'fine'", () => {
    // M-heatgrid measured 20.68:1 and passed v1 — that is how a 121px strip nearly led a package.
    assert.equal(aspectVerdict(2502, 121).verdict, "sliver");
  });
  it("calls a 1.94:1 desk frame wide — correct, and it still renders fine", () => {
    // Not a defect: past 16:9 X may letterbox, which costs presence but not legibility.
    assert.equal(aspectVerdict(2512, 1294).verdict, "wide");
  });
  it("calls a 1.6:1 frame ideal", () => {
    assert.equal(aspectVerdict(1600, 1000).verdict, "ideal");
  });
  it("flags a portrait frame X would crop", () => {
    assert.equal(aspectVerdict(600, 1200).verdict, "too-tall");
  });
});

describe("scoreFrame", () => {
  it("rejects an empty frame", () => {
    const s = scoreFrame(canvas(1200, 800), 1200, 800);
    assert.equal(s.pass, false);
    assert.match(s.rejects.join(" "), /almost no content/);
  });
  it("passes a dense, coarse, well-proportioned frame", () => {
    const w = 1600, h = 900, b = canvas(w, h);
    stripes(b, w, 40, 40, w - 40, h - 40, 20);
    assert.equal(scoreFrame(b, w, h).pass, true);
  });
});

describe("scoreFrame — edge contact warns, it does not reject", () => {
  // A correctly framed Vector chart runs its volume pane to the bottom edge on purpose. v1
  // rejected on that and threw away the one frame in the package that was actually right. These
  // pixels cannot tell intent from truncation, so the call belongs to the reviewer.
  function fullBleedChart() {
    const w = 1600, h = 900, b = canvas(w, h);
    stripes(b, w, 40, 40, w - 40, h - 60, 20);
    fill(b, w, 0, h - 60, w, h, 190); // volume pane, flush to the bottom
    return { b, w, h };
  }

  it("still passes a frame whose content reaches the bottom edge", () => {
    const { b, w, h } = fullBleedChart();
    const s = scoreFrame(b, w, h);
    assert.ok(s.edges.bottom > 0.5, `test fixture must touch the edge, got ${s.edges.bottom}`);
    assert.equal(s.pass, true, `rejected on: ${s.rejects.join("; ")}`);
  });

  it("surfaces the edge contact as a warning so a reviewer can still see it", () => {
    const { b, w, h } = fullBleedChart();
    assert.match(scoreFrame(b, w, h).warnings.join(" "), /reaches the bottom edge/);
  });

  it("keeps warnings empty when nothing touches an edge", () => {
    const w = 1600, h = 900, b = canvas(w, h);
    stripes(b, w, 40, 40, w - 40, h - 40, 20);
    assert.deepEqual(scoreFrame(b, w, h).warnings, []);
  });
});

describe("largestEmptyBand — the axis must not hide a dead chart", () => {
  it("finds a dead band that a price axis would otherwise mask", () => {
    // The failure exactly: content in the top half, nothing in the bottom half, and an axis label
    // on EVERY row at the right edge. Measuring full width, no row is empty and the band reads 0.
    const w = 1200, h = 800, b = canvas(w, h);
    stripes(b, w, 0, 0, 1000, 380, 20);
    for (let y = 0; y < h; y += 20) fill(b, w, 1150, y, 1190, y + 6, 210); // axis labels, every row
    const withGutter = largestEmptyBand(b, w, h).fraction;
    const fullWidth = largestEmptyBand(b, w, h, { gutter: 0 }).fraction;
    assert.ok(withGutter > 0.4, `should see the dead half, got ${withGutter}`);
    assert.ok(fullWidth < 0.1, `full-width measurement should be fooled, got ${fullWidth}`);
  });

  it("still reports no band when the plot is full", () => {
    const w = 1200, h = 800, b = canvas(w, h);
    stripes(b, w, 0, 0, 1000, h, 20);
    assert.ok(largestEmptyBand(b, w, h).fraction < 0.05);
  });
});

describe("scoreFrame — empty space warns well before it rejects", () => {
  it("warns on a frame a quarter empty without failing it", () => {
    // Content in the upper band only, grid lines throughout — the shape largestEmptyBand cannot
    // see, because a line every few rows means no row is ever empty.
    const w = 1600, h = 1000, b = canvas(w, h);
    stripes(b, w, 40, 40, w - 40, 600, 20);
    for (let y = 600; y < h; y += 150) fill(b, w, 40, y, w - 40, y + 1, 40);
    const s = scoreFrame(b, w, h);
    assert.equal(s.pass, true, `rejected on: ${s.rejects.join("; ")}`);
    assert.match(s.warnings.join(" "), /empty region/);
  });
});
