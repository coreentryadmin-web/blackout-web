/**
 * MEASURE THE DEAD CANVAS ON A COMPOSED LARGO CARD.
 *
 * `composeCard` packs against ESTIMATED block heights, and until now nothing compared those
 * estimates to the pixels satori actually draws. A systematic over-estimate looks exactly like
 * what the live NVDA card showed: a fifth of the canvas blank, printed underneath a footnote
 * claiming there was no room for five more blocks. Both statements cannot be true.
 *
 * This renders a card for real and scans upward from the bottom for the first row that is not the
 * background, then reports estimated-vs-drawn per size. Read-only, offline, no network.
 *
 *   node --import tsx scripts/audit/largo-card-deadspace.mjs [--sizes=a,b] [--json]
 */
import sharp from "sharp";
import * as React from "react";
import { createRequire } from "node:module";

// tsx compiles the templates' JSX with the classic runtime, which emits bare `React.createElement`
// calls. Next supplies that automatically; a plain node harness does not, so bind it globally.
globalThis.React = React;

// `render.tsx` opens with `import "server-only"`, whose default entry throws outside a React
// Server Component. Running under `--conditions=react-server` silences that but then breaks the
// `react` import, so instead the module is pre-resolved to an empty exports object. Nothing in the
// render path uses it — it exists purely to fail a client bundle at build time.
const require_ = createRequire(import.meta.url);
require_.cache[require_.resolve("server-only")] = { id: "server-only", exports: {}, loaded: true };

const { renderVisual } = await import("../../src/lib/largo/visual/render.tsx");
const { sizeSpec } = await import("../../src/lib/largo/visual/sizes.ts");
const { composeForRender, BLOCKS } = await import("../../src/lib/largo/visual/compose.ts");
const { FIXTURE_QUESTION, richFixtureBundle } = await import("../../src/lib/largo/visual/fixture-bundle.ts");

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const SIZES = (args.get("sizes") ?? "x_portrait,x_landscape,story").split(",");
const JSON_OUT = args.has("json");

/**
 * The LARGEST UNBROKEN RUN OF BACKGROUND ROWS inside the card.
 *
 * Not the space below the last drawn pixel — the footer is pinned to the bottom edge, so that
 * number is always zero and says nothing. The gap that matters is the one the evidence leaves
 * ABOVE the footer, which is exactly the packer's cumulative height over-estimate made visible.
 */
const EDGE = 8;

async function largestGap(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const blank = new Array(info.height);
  for (let y = 0; y < info.height; y++) {
    // The reference is this ROW's own left-edge pixel, not the card's top-left. The shell paints a
    // vertical gradient, so a single global background colour marks every row as content and the
    // measurement silently reports no gap anywhere — which is what the first cut of this did.
    // MARGIN, because the shell paints a 1px border around the whole canvas: without it every
    // single row carries four bright pixels and NO row ever reads as blank — which is why the
    // first cut of this measurement reported a 0px gap on a card with a quarter of it empty.
    const r = (y * info.width + EDGE) * ch;
    const bg = [data[r], data[r + 1], data[r + 2]];
    let differs = 0;
    for (let x = EDGE; x < info.width - EDGE && differs <= 2; x++) {
      const i = (y * info.width + x) * ch;
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) differs++;
    }
    blank[y] = differs <= 2;
  }
  let best = { start: 0, len: 0 };
  let run = 0;
  for (let y = 0; y < info.height; y++) {
    run = blank[y] ? run + 1 : 0;
    if (run > best.len) best = { start: y - run + 1, len: run };
  }
  return { height: info.height, gap: best.len, gapStart: best.start };
}

/**
 * CALIBRATION — what each block ESTIMATES against what it DRAWS.
 *
 * One block at a time, everything else excluded, so the difference between two renders of the same
 * card with and without it is that block and nothing else. The baseline (no evidence blocks at all)
 * carries the header and the footer, which every card pays for regardless.
 */
async function calibrate(size) {
  const spec = sizeSpec(size);
  const bundle = richFixtureBundle();
  const all = BLOCKS.map((b) => b.id);

  const contentSpan = async (exclude) => {
    const { buffer } = await renderVisual({ template: "COMPOSED", bundle, size, question: FIXTURE_QUESTION, exclude });
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let firstY = -1;
    let lastY = -1;
    const blank = new Array(info.height).fill(true);
    for (let y = 0; y < info.height; y++) {
      const r = (y * info.width + EDGE) * ch;
      const bg = [data[r], data[r + 1], data[r + 2]];
      let differs = 0;
      for (let x = EDGE; x < info.width - EDGE && differs <= 2; x++) {
        const i = (y * info.width + x) * ch;
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) differs++;
      }
      if (differs > 2) {
        blank[y] = false;
        if (firstY < 0) firstY = y;
        lastY = y;
      }
    }
    // The evidence ends where the biggest blank run begins — NOT at the last drawn pixel, which is
    // always the pinned footer and therefore identical on every card. Measuring to `lastY` is what
    // made the first calibration pass report a drawn height of zero for every block.
    let best = { start: lastY, len: 0 };
    let run = 0;
    for (let y = 0; y < info.height; y++) {
      run = blank[y] ? run + 1 : 0;
      if (run > best.len) best = { start: y - run + 1, len: run };
    }
    return { firstY, lastY, contentEnd: best.start };
  };

  console.log(`\n=== CALIBRATION ${size} (scale ${spec.scale})`);
  console.log("  block            est   drawn   ratio");
  for (const id of all) {
    const specB = BLOCKS.find((b) => b.id === id);
    if (!specB.available(bundle)) continue;
    // The verdict block cannot be excluded from its own baseline, so it is measured against a card
    // that has nothing else; every other block is measured against that same verdict-only card.
    const withOnly = await contentSpan(all.filter((x) => x !== id && x !== "verdict"));
    const baseline = await contentSpan(all.filter((x) => x !== "verdict"));
    const drawnReal = id === "verdict" ? baseline.contentEnd - baseline.firstY : withOnly.contentEnd - baseline.contentEnd;
    const drawn = drawnReal / spec.scale;
    const est = specB.height(bundle, spec);
    if (args.has("verbose")) console.log(`     [${id}] only(first=${withOnly.firstY} end=${withOnly.contentEnd} last=${withOnly.lastY}) base(first=${baseline.firstY} end=${baseline.contentEnd} last=${baseline.lastY})`);
    console.log(
      `  ${id.padEnd(16)} ${String(est).padStart(4)}  ${drawn.toFixed(0).padStart(5)}   ${(drawn / est).toFixed(2)}`
    );
  }
}

if (args.has("calibrate")) {
  for (const size of SIZES) await calibrate(size);
  process.exit(0);
}

const rows = [];
for (const size of SIZES) {
  const bundle = richFixtureBundle();
  const spec = sizeSpec(size);
  const { composition } = composeForRender({ question: FIXTURE_QUESTION, bundle, spec, emphasis: null });
  const { buffer } = await renderVisual({ template: "COMPOSED", bundle, size, question: FIXTURE_QUESTION });
  const m = await largestGap(buffer);
  if (args.has("out")) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${args.get("out")}/CARD-${size}.png`, buffer);
  }
  // The footer is pinned to the bottom, so real dead space is the gap ABOVE it, not below the last
  // drawn pixel — measure the estimate error instead, in the unscaled px the packer works in.
  const row = {
    size,
    budget: composition.budget,
    used: composition.used,
    dropped: composition.dropped.map((d) => d.id),
    blocks: composition.blocks.map((b) => ({ id: b.id, est: b.estHeight, compact: b.compact })),
    canvasHeight: m.height,
    gapPx: m.gap,
    gapStartRow: m.gapStart,
  };
  rows.push(row);
  if (!JSON_OUT) {
    console.log(`\n=== ${size}  canvas ${spec.width}x${spec.height} scale ${spec.scale}`);
    console.log(`  blocks : ${row.blocks.map((b) => `${b.id}${b.compact ? "*" : ""}=${b.est}`).join(" ")}`);
    console.log(`  dropped: ${row.dropped.join(", ") || "-"}`);
    console.log(`  budget=${row.budget} used=${row.used} slack=${row.budget - row.used}`);
    console.log(`  largestGap=${m.gap}px at y=${m.gapStart} of ${m.height} (${((m.gap / m.height) * 100).toFixed(1)}%)`);
  }
}
if (JSON_OUT) console.log(JSON.stringify(rows, null, 2));
