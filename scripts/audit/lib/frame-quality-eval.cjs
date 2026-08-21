/**
 * Pure pixel→verdict helpers for X attachment quality. No browser, no network, no sharp — these
 * take a raw RGBA buffer plus its dimensions and return NUMBERS, so they can be unit-tested
 * against synthetic images whose right answer is known by construction.
 *
 * Same separation as `bead-pixel-eval.cjs`, and for the same reason: the whole value of this is
 * that it measures what a reader sees, and a measurement nobody has checked is worth no more than
 * the eyeballing it replaced.
 *
 * ── WHY MEASURE AT ALL ─────────────────────────────────────────────────────────────────────────
 *
 * The Screenshot Playbook's reject list — dead space, unreadable text, cut-off panels, awkward
 * crops — was prose, which means it was applied by whoever remembered to apply it. Every one of
 * those is a measurable property of the PNG. Judging a frame by eye at full resolution is exactly
 * how a capture with beads that cluster at phone size gets approved: it looked fine on the monitor
 * it was reviewed on.
 *
 * ── THE ONE THAT MATTERS MOST ──────────────────────────────────────────────────────────────────
 *
 * `timelineLegibility` downscales to the width X actually renders a single image at in-feed and
 * measures how much high-frequency detail SURVIVES. Text and numbers are high-frequency; a frame
 * whose detail collapses under that downscale is a frame whose numbers a reader cannot read
 * without tapping. That is the difference between evidence and decoration, and it is invisible at
 * 100% zoom.
 */

/** X renders a single in-feed image at roughly this width on a phone. */
const TIMELINE_WIDTH = 600;

/**
 * Luminance, 0–255. Rec. 601 weights — the desks are dark UIs where green/amber text on near-black
 * carries almost all the signal, and a naive channel average under-weights green badly.
 */
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * The frame's background level, taken as the MEDIAN luminance rather than the mean.
 *
 * The desks are near-black with bright sparse content, so the mean is dragged up by exactly the
 * pixels that matter and would classify real content as background. The median is the canvas.
 */
function backgroundLuma(rgba, width, height) {
  const hist = new Uint32Array(256);
  const stride = 4;
  const step = Math.max(1, Math.floor((width * height) / 200_000));
  let n = 0;
  for (let p = 0; p < width * height; p += step) {
    const i = p * stride;
    hist[Math.round(luma(rgba[i], rgba[i + 1], rgba[i + 2]))] += 1;
    n += 1;
  }
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= n / 2) return v;
  }
  return 0;
}

/** A pixel carries content when it is meaningfully brighter or darker than the canvas. */
function isInk(rgba, idx, bg, threshold) {
  const l = luma(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
  return Math.abs(l - bg) > threshold;
}

/**
 * Fraction of the frame carrying content, 0–1.
 *
 * Low ink is the measurable form of "huge empty areas" and of a loading skeleton — both render as
 * a large expanse of canvas with a little furniture on it.
 */
function inkRatio(rgba, width, height, { threshold = 12 } = {}) {
  const bg = backgroundLuma(rgba, width, height);
  let ink = 0;
  const total = width * height;
  for (let p = 0; p < total; p += 1) {
    if (isInk(rgba, p * 4, bg, threshold)) ink += 1;
  }
  return ink / total;
}

/**
 * The largest run of consecutive all-canvas ROWS, as a fraction of height.
 *
 * Measured per row against the frame's own background rather than against black: the desks paint
 * gradients and 1px borders, so a global "is this pixel black" test reports a 0px gap on a card
 * that is visibly a quarter empty. That specific mistake is recorded in the Largo card work and is
 * not repeated here.
 */
/**
 * `gutter` EXISTS BECAUSE THE AXIS DEFEATED THIS CHECK.
 *
 * A Vector frame whose bottom third was visibly dead black scored `dead 0%`. The reason is that a
 * price axis prints a label on EVERY row of the frame, so no row is ever empty across the full
 * width and the run never starts — the metric was reporting on the axis, not on the chart.
 *
 * MEASURED 2026-08-21: the operator pointed at the black space and asked how much of it there was,
 * and the scorer's answer was "none". Ignoring the right-hand gutter measures the plot instead.
 * 8% of width comfortably covers the axis column without reaching into the candles.
 */
function largestEmptyBand(
  rgba,
  width,
  height,
  { threshold = 12, minInkPerRow = 0.002, gutter = 0.08 } = {},
) {
  const bg = backgroundLuma(rgba, width, height);
  const plotW = Math.max(1, Math.floor(width * (1 - gutter)));
  let best = 0;
  let run = 0;
  let bestStart = 0;
  let runStart = 0;
  for (let y = 0; y < height; y += 1) {
    let ink = 0;
    for (let x = 0; x < plotW; x += 1) {
      if (isInk(rgba, (y * width + x) * 4, bg, threshold)) ink += 1;
    }
    if (ink / plotW < minInkPerRow) {
      if (run === 0) runStart = y;
      run += 1;
      if (run > best) { best = run; bestStart = runStart; }
    } else {
      run = 0;
    }
  }
  return { fraction: best / height, startFraction: bestStart / height, rows: best };
}

/**
 * How much detail survives being rendered at timeline width, 0–1 (1 = nothing lost).
 *
 * Box-downscales to `TIMELINE_WIDTH`, then compares mean absolute horizontal gradient before and
 * after. Text and numbers are high-frequency, so a frame that loses most of its gradient energy is
 * a frame whose numbers have become texture. A frame already at or below timeline width scores 1 —
 * there is nothing to lose.
 */
function timelineLegibility(rgba, width, height, { targetWidth = TIMELINE_WIDTH } = {}) {
  if (width <= targetWidth) return 1;
  const scale = width / targetWidth;
  const outW = targetWidth;
  const outH = Math.max(1, Math.round(height / scale));

  // Box-downscale to timeline width, then UPSCALE back and measure how far the reconstruction is
  // from the original. That is literally "what did the reader lose". The first version compared
  // gradient energy before/after and normalised by the scale factor — which cancels the signal it
  // was trying to measure and returned 1.00 for every frame, including ones with 6pt type. A
  // metric that passes everything is not a lenient metric, it is a broken one.
  const small = new Float64Array(outW * outH);
  const counts = new Float64Array(outW * outH);
  for (let y = 0; y < height; y += 1) {
    const oy = Math.min(outH - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const ox = Math.min(outW - 1, Math.floor(x / scale));
      const i = (y * width + x) * 4;
      small[oy * outW + ox] += luma(rgba[i], rgba[i + 1], rgba[i + 2]);
      counts[oy * outW + ox] += 1;
    }
  }
  for (let i = 0; i < small.length; i += 1) if (counts[i]) small[i] /= counts[i];

  // Error is measured ONLY where the original carries content. Averaging over the whole frame lets
  // a large empty canvas dilute the error of the one panel the reader actually needs to read.
  const bg = backgroundLuma(rgba, width, height);
  let err = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(height / 400));
  for (let y = 0; y < height; y += step) {
    const oy = Math.min(outH - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const l = luma(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (Math.abs(l - bg) <= 12) continue;
      const ox = Math.min(outW - 1, Math.floor(x / scale));
      err += Math.abs(l - small[oy * outW + ox]);
      n += 1;
    }
  }
  if (!n) return 1;
  // Normalised against the content's own contrast against canvas: losing 40 levels matters more on
  // dim text than on a bright badge.
  const meanContrast = contrastOverInk(rgba, width, height, bg);
  const relErr = err / n / Math.max(1, meanContrast);
  return Math.max(0, Math.min(1, 1 - relErr));
}

function contrastOverInk(rgba, width, height, bg) {
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(height / 400));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const d = Math.abs(luma(rgba[i], rgba[i + 1], rgba[i + 2]) - bg);
      if (d > 12) { sum += d; n += 1; }
    }
  }
  return n ? sum / n : 1;
}


/**
 * Whether content runs into the frame edge — the measurable form of "cut-off panel".
 *
 * Reports per edge so a caller can tell a deliberate full-bleed chart (content at left and right,
 * which is correct for a chart) from a genuinely truncated panel (content jammed against the
 * bottom mid-row).
 */
function edgeClipping(rgba, width, height, { threshold = 12, band = 2 } = {}) {
  const bg = backgroundLuma(rgba, width, height);
  const frac = (pts) => {
    let ink = 0;
    for (const [x, y] of pts) if (isInk(rgba, (y * width + x) * 4, bg, threshold)) ink += 1;
    return pts.length ? ink / pts.length : 0;
  };
  const top = [], bottom = [], left = [], right = [];
  for (let x = 0; x < width; x += 1) {
    for (let b = 0; b < band; b += 1) {
      top.push([x, b]);
      bottom.push([x, height - 1 - b]);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let b = 0; b < band; b += 1) {
      left.push([b, y]);
      right.push([width - 1 - b, y]);
    }
  }
  return { top: frac(top), bottom: frac(bottom), left: frac(left), right: frac(right) };
}

/**
 * Aspect ratio verdict for a single in-feed image.
 *
 * X shows a single image up to roughly 16:9 before cropping, and very tall frames are reduced to a
 * sliver of their own height. A frame that will be cropped is a frame whose composition the reader
 * never sees.
 */
/**
 * Fraction of a coarse grid whose cells are essentially empty.
 *
 * The row-band measure misses the shape that actually occurs: a frame that is busy at the top and
 * dead in one whole REGION — the Night Hawk board with a populated left rail and an empty
 * "select a play" right panel scored 3% dead band while being visibly half empty. A grid catches
 * that; a row scan cannot, because every row contains some chrome.
 */
function gridEmptiness(rgba, width, height, { cols = 12, rows = 8, threshold = 12, cellInk = 0.004 } = {}) {
  const bg = backgroundLuma(rgba, width, height);
  let empty = 0;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const x0 = Math.floor((cx * width) / cols);
      const x1 = Math.floor(((cx + 1) * width) / cols);
      const y0 = Math.floor((cy * height) / rows);
      const y1 = Math.floor(((cy + 1) * height) / rows);
      let ink = 0;
      let n = 0;
      const sx = Math.max(1, Math.floor((x1 - x0) / 40));
      const sy = Math.max(1, Math.floor((y1 - y0) / 40));
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          if (isInk(rgba, (y * width + x) * 4, bg, threshold)) ink += 1;
          n += 1;
        }
      }
      if (n && ink / n < cellInk) empty += 1;
    }
  }
  return empty / (cols * rows);
}

function aspectVerdict(width, height) {
  const ratio = width / height;
  // Beyond ~3:1 a frame renders as a letterboxed sliver in-feed: the height collapses and the type
  // goes with it. M-heatgrid measured 20.68:1 and "passed" the first version of this check, which
  // is how a 121px-tall strip nearly became a lead attachment.
  if (ratio > 3.2) return { ratio, verdict: "sliver", note: `${ratio.toFixed(1)}:1 renders as a letterboxed strip — pair it, never lead with it` };
  if (ratio > 1.78) return { ratio, verdict: "wide", note: "wider than 16:9 — fine, may letterbox" };
  if (ratio >= 1.2) return { ratio, verdict: "ideal", note: "renders in-feed without cropping" };
  if (ratio >= 0.8) return { ratio, verdict: "square", note: "acceptable, less feed presence" };
  return { ratio, verdict: "too-tall", note: "taller than 5:4 — X will crop it; reframe or split" };
}

/**
 * The whole verdict. Thresholds are deliberately explicit so a reviewer can argue with a NUMBER
 * rather than with a judgement, and so they can be tuned from measurement once posts exist.
 */
function scoreFrame(rgba, width, height) {
  const ink = inkRatio(rgba, width, height);
  const band = largestEmptyBand(rgba, width, height);
  const legibility = timelineLegibility(rgba, width, height);
  const edges = edgeClipping(rgba, width, height);
  const aspect = aspectVerdict(width, height);
  const emptyCells = gridEmptiness(rgba, width, height);

  const rejects = [];
  const warnings = [];
  if (emptyCells > 0.45) rejects.push(`${(emptyCells * 100).toFixed(0)}% of the frame is empty region — reframe onto the content`);
  if (aspect.verdict === "sliver") rejects.push(aspect.note);
  if (ink < 0.02) rejects.push(`almost no content (ink ${(ink * 100).toFixed(1)}%) — empty or a loading state`);
  if (band.fraction > 0.28) rejects.push(`dead band covering ${(band.fraction * 100).toFixed(0)}% of the height`);
  if (legibility < 0.55) rejects.push(`detail collapses at timeline width (legibility ${legibility.toFixed(2)}) — numbers unreadable without tapping`);
  if (aspect.verdict === "too-tall") rejects.push(`aspect ${aspect.ratio.toFixed(2)}:1 — ${aspect.note}`);
  // Edge contact is a WARNING, not a reject.
  //
  // The header on `edgeClipping` says the per-edge split exists so a caller can tell a deliberate
  // full-bleed chart from a truncated panel — and then the first version rejected on it anyway. A
  // correctly framed Vector chart runs its volume pane to the bottom edge by design and scored
  // 100% there; rejecting that trains a reviewer to ignore the checker, which is worse than not
  // having one. Distinguishing intent from truncation is not something these pixels can do, so it
  // is surfaced for a human instead of decided for them.
  // EMPTY SPACE IS A COMPOSITION FAULT LONG BEFORE IT IS A REJECT.
  //
  // The reject sits at 45%, which is a frame that is mostly nothing. But the operator pointed at a
  // frame at 18% and asked how much black space it had — and at that level it is worth saying so,
  // because a third of a chart showing no beads, no candles and no walls is a third of the reader's
  // attention spent on grid lines.
  //
  // It is a WARNING and not a reject because the honest answer is per-ticker: NVDA's strikes sit
  // 2.50 apart on a 215 underlying, so a frame wide enough to hold six bead levels necessarily
  // holds gaps between them. Whether that gap is waste or context is a judgement about the story,
  // and the pixels do not know the story.
  if (emptyCells > 0.15 && emptyCells <= 0.45) warnings.push(`${(emptyCells * 100).toFixed(0)}% of the frame is empty region — tighten the price range if those levels are not part of the story`);
  if (edges.bottom > 0.5) warnings.push(`content reaches the bottom edge (${(edges.bottom * 100).toFixed(0)}%) — intended for a full-bleed chart, a truncated panel otherwise`);
  if (edges.top > 0.5) warnings.push(`content reaches the top edge (${(edges.top * 100).toFixed(0)}%)`);

  return { ink, band, legibility, edges, aspect, emptyCells, rejects, warnings, pass: rejects.length === 0 };
}

module.exports = {
  TIMELINE_WIDTH,
  luma,
  backgroundLuma,
  inkRatio,
  largestEmptyBand,
  timelineLegibility,
  edgeClipping,
  aspectVerdict,
  gridEmptiness,
  scoreFrame,
};
