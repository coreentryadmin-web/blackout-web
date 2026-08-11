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

/**
 * THE PLATE: a card carrying the verdict and nothing else.
 *
 * Not a card with every block excluded — `render.tsx` deliberately refuses to draw a COMPOSED card
 * with no evidence, and that refusal is correct product behaviour. The verdict is on every card by
 * construction (highest weight, always chosen), so a verdict-only render of the SAME question and
 * size cancels the shell, the gradient, the header, the footer AND the verdict exactly, leaving
 * only the evidence blocks under measurement.
 *
 * This plate is the reference every measurement below diffs against, and it replaces two earlier
 * attempts that both silently reported "no gap" on cards that were visibly a quarter empty:
 *
 *   1. one global background colour — defeated by the shell's gradient AND its 1px border;
 *   2. each ROW's own left-edge pixel — defeated by the gradient being HORIZONTAL as well, so a
 *      genuinely blank row still differs from its own left edge across x.
 *
 * Diffing two renders of the same shell at the same size cancels the shell exactly, whatever it
 * paints, so "is there evidence on this row" stops depending on any assumption about the artwork.
 */
const plateCache = new Map();
async function backgroundPlate(size, bundle) {
  if (plateCache.has(size)) return plateCache.get(size);
  const { buffer } = await renderVisual({
    template: "COMPOSED",
    bundle,
    size,
    question: FIXTURE_QUESTION,
    exclude: BLOCKS.map((b) => b.id).filter((id) => id !== "verdict"),
  });
  const raw = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  plateCache.set(size, raw);
  return raw;
}

/** The last row carrying anything the plate does not, i.e. where this card's evidence ends. */
function contentEnd(card, plate) {
  const { data, info } = card;
  const ref = plate.data;
  const ch = info.channels;
  for (let y = info.height - 1; y >= 0; y--) {
    let differs = 0;
    for (let x = EDGE; x < info.width - EDGE && differs <= 2; x++) {
      const i = (y * info.width + x) * ch;
      if (
        Math.abs(data[i] - ref[i]) + Math.abs(data[i + 1] - ref[i + 1]) + Math.abs(data[i + 2] - ref[i + 2]) >
        24
      ) {
        differs++;
      }
    }
    if (differs > 2) return y;
  }
  return 0;
}

/** The first such row — where the evidence starts, below the header. */
function contentStart(card, plate) {
  const { data, info } = card;
  const ref = plate.data;
  const ch = info.channels;
  for (let y = 0; y < info.height; y++) {
    let differs = 0;
    for (let x = EDGE; x < info.width - EDGE && differs <= 2; x++) {
      const i = (y * info.width + x) * ch;
      if (
        Math.abs(data[i] - ref[i]) + Math.abs(data[i + 1] - ref[i + 1]) + Math.abs(data[i + 2] - ref[i + 2]) >
        24
      ) {
        differs++;
      }
    }
    if (differs > 2) return y;
  }
  return 0;
}

/**
 * Dead canvas: the space the evidence leaves between where it ends and the top of the pinned
 * footer. That is the packer's cumulative height over-estimate made visible — the room it believed
 * was spent, and therefore the room it refused to give the blocks it dropped instead.
 */
async function deadSpace(png, size, bundle) {
  const plate = await backgroundPlate(size, bundle);
  const card = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const spec = sizeSpec(size);
  const end = contentEnd(card, plate);
  const footerTop = card.info.height - spec.footer * spec.scale;
  /**
   * SIGNED. A negative gap is evidence OVERLAPPING the pinned footer — the failure this measurement
   * exists to catch, and the one that clamping to zero hid: an over-tightened estimate reported a
   * perfect "0px dead space" on a card whose last block was drawing through the disclaimer.
   */
  return {
    height: card.info.height,
    contentEnd: end,
    footerTop: Math.round(footerTop),
    gap: Math.round(footerTop - end),
  };
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

  const plate = await backgroundPlate(size, bundle);
  const contentSpan = async (exclude) => {
    const { buffer } = await renderVisual({ template: "COMPOSED", bundle, size, question: FIXTURE_QUESTION, exclude });
    const card = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    return { firstY: contentStart(card, plate), contentEnd: contentEnd(card, plate) };
  };

  console.log(`\n=== CALIBRATION ${size} (scale ${spec.scale})`);
  console.log("  block            est   drawn   ratio");
  for (const id of all) {
    const specB = BLOCKS.find((b) => b.id === id);
    if (!specB.available(bundle)) continue;
    // The verdict IS the plate, so it cancels itself and has no span to measure. Every other block
    // is rendered alone alongside it: its span is then literally the pixels it drew.
    if (id === "verdict") {
      console.log(`  ${id.padEnd(16)} ${String(specB.height(bundle, spec)).padStart(4)}      -       -   (plate)`);
      continue;
    }
    const withOnly = await contentSpan(all.filter((x) => x !== id && x !== "verdict"));
    const drawn = (withOnly.contentEnd - withOnly.firstY) / spec.scale;
    const est = specB.height(bundle, spec);
    if (args.has("verbose")) console.log(`     [${id}] only(first=${withOnly.firstY} end=${withOnly.contentEnd}) base(first=${baseline.firstY} end=${baseline.contentEnd})`);
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
  const m = await deadSpace(buffer, size, bundle);
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
    contentEndRow: m.contentEnd,
    footerTopRow: m.footerTop,
  };
  rows.push(row);
  if (!JSON_OUT) {
    console.log(`\n=== ${size}  canvas ${spec.width}x${spec.height} scale ${spec.scale}`);
    console.log(`  blocks : ${row.blocks.map((b) => `${b.id}${b.compact ? "*" : ""}=${b.est}`).join(" ")}`);
    console.log(`  dropped: ${row.dropped.join(", ") || "-"}`);
    console.log(`  budget=${row.budget} used=${row.used} slack=${row.budget - row.used}`);
    const verdict = m.gap < 0 ? `OVERLAPS FOOTER by ${-m.gap}px` : `deadSpace=${m.gap}px`;
    console.log(`  ${verdict} (content ends y=${m.contentEnd}, footer starts y=${m.footerTop}, canvas ${m.height}) = ${((m.gap / m.height) * 100).toFixed(1)}%`);
  }
}
if (JSON_OUT) console.log(JSON.stringify(rows, null, 2));
