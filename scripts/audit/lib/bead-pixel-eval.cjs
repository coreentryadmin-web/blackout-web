/**
 * Pure pixel→verdict helpers for `vector-bead-pixel-audit.cjs`. No browser, no network, no sharp —
 * these take a raw RGBA buffer and return numbers, so they can be unit-tested against synthetic
 * images where the right answer is known by construction.
 *
 * The separation matters: the audit's whole value is that it measures what the member sees, and a
 * measurement nobody has checked is worth no more than the visualization it was built to check.
 */

/** Absolute floor for "painted, not chart ground". Low on purpose — the rail's fill-alpha floor is
 *  0.25, so a weak bead over near-black sits in the 50s. An absolute gate here is what made the
 *  first version blind to dim beads. */
const DIM_FLOOR = 32;

/**
 * Is this pixel part of a bead?
 *
 * THE COLOURS ARE THE WHOLE POINT (corrected 2026-08-19). The intraday GEX lens draws the rail in
 * AMBER for calls and VIOLET for puts:
 *
 *     CALL_WALL_COLOR = "#ffd60a"   (255, 214,  10)
 *     PUT_WALL_COLOR  = "#d97bff"   (217, 123, 255)
 *
 * The first version of this file tested for CYAN calls and RED puts. Neither is a bead colour on
 * this surface — cyan is the GAMMA FLIP guide (`#22d3ee`) and red is a DOWN CANDLE. So the audit was
 * not measuring the rail at all; it clustered the flip line and candle bodies and reported their
 * geometry as bead size. Every count, radius and ratio it produced before this fix is void.
 *
 * Both tests are RATIOS so they hold across the whole fill-alpha range (0.25-0.98) — an absolute
 * channel threshold is precisely what discarded dim beads before:
 *
 *   amber : red and green far above blue, red >= green
 *           -> a GREEN candle fails (low red); a DOWN candle fails (low green)
 *   violet: blue above green, red above green, blue comparable to red
 *           -> the cyan flip line fails (green exceeds red); a red candle fails (low blue)
 *
 * VEX lens (`#7dd3fc` / `#fb7185`) is deliberately NOT matched: the desk opens on GEX, and silently
 * accepting a second palette would let a run measure a different lens than it reports.
 */
function classifyPixel(r, g, b, a, dimFloor = DIM_FLOOR) {
  if (a < 40) return null;
  const max = Math.max(r, g, b);
  if (max < dimFloor) return null;
  const min = Math.min(r, g, b);
  if ((max - min) / (max || 1) < 0.28) return null; // grey chrome: axis text, crosshair

  if (r > b * 2.2 && g > b * 1.8 && r >= g * 0.95) return "call";
  if (b > g * 1.5 && r > g * 1.25 && b > r * 0.85) return "put";
  return null;
}

/**
 * Connected-component cluster of bead pixels, 4-neighbour, iterative flood fill.
 *
 * Iterative rather than recursive on purpose: a wide bead on a 1920px capture can exceed the call
 * stack, and a RangeError mid-run would read as "the rail failed to render".
 */
function clusterBeadPixels(data, width, height, channels = 4) {
  const kind = new Uint8Array(width * height); // 0 none, 1 call, 2 put
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const a = channels > 3 ? data[o + 3] : 255;
    const c = classifyPixel(r, g, b, a);
    if (!c) continue;
    kind[i] = c === "call" ? 1 : 2;
    // Perceptual-ish luminance. This is the audit's proxy for the ALPHA channel: the rail composites
    // a translucent fill over a near-black ground, so a lower-alpha bead lands darker. Reading alpha
    // directly is not possible — the screenshot is already flattened.
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const seen = new Uint8Array(width * height);
  const clusters = [];
  const merged = [];
  const stack = [];
  for (let start = 0; start < kind.length; start++) {
    if (!kind[start] || seen[start]) continue;
    const side = kind[start];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let area = 0;
    let lumSum = 0;
    let lumMax = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx - x) / width;
      area++;
      lumSum += lum[idx];
      if (lum[idx] > lumMax) lumMax = lum[idx];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && kind[idx - 1] === side && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x + 1 < width && kind[idx + 1] === side && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && kind[idx - width] === side && !seen[idx - width]) { seen[idx - width] = 1; stack.push(idx - width); }
      if (y + 1 < height && kind[idx + width] === side && !seen[idx + width]) { seen[idx + width] = 1; stack.push(idx + width); }
    }
    // Single stray pixels are antialiasing on some other element, not a bead.
    //
    // CAVEAT, and it matters when reading a RED run: this cutoff interacts with the very defect the
    // audit detects. A bead of radius ~1.1px covers ~3.8px of area BEFORE antialiasing softens its
    // edge, so on a rail that has collapsed to sub-pixel beads an unknown share of them fall under
    // this threshold and are never counted. The NVDA run of 2026-08-18 reported 18 beads against a
    // recorded rail carrying 546 samples x 20 walls — the count was suppressed BY the smallness, not
    // by missing data (the recorder was verified healthy separately with vector-bead-probe.mjs).
    // So on a RED verdict, treat `count` as a LOWER BOUND and fix the radius before reading it as a
    // data-supply problem; on a GREEN verdict the beads are large enough that the cutoff is inert.
    if (area < 3) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    // A bead is round-ish. A long thin run is a price line, a wall guide or a candle wick, and
    // counting those would inflate the bead count AND flatten the size distribution toward one
    // value — the exact failure this audit exists to detect, so it must not create it itself.
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    if (aspect > 4) {
      // A long thin run is EITHER a price line OR a row of beads that has merged into a ribbon.
      // Silently dropping it hides the second case, which at a wide zoom is the NORMAL appearance
      // of a 5-second bead cadence compressed into a session — not a defect. Record it so a run
      // reports "this zoom is too wide to resolve beads" instead of "there are almost no beads".
      merged.push({ side: side === 1 ? "call" : "put", area, width: w, height: h });
      continue;
    }
    clusters.push({
      side: side === 1 ? "call" : "put",
      area,
      // Equivalent-circle radius. Robust to the bead being drawn as a disc, a ring, or a rounded
      // square, all of which the rail has used at different times.
      radius: Math.sqrt(area / Math.PI),
      lumMean: lumSum / area,
      lumMax,
      x: minX + w / 2,
      y: minY + h / 2,
    });
  }
  clusters.mergedRuns = merged;
  return clusters;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Luminance spread measured WITHIN a side, then maxed across sides.
 *
 * Measuring it across all beads at once is wrong and quietly so: the call palette (cyan) is far
 * brighter than the put palette (red) at identical alpha, so a rail where every single bead is
 * fully opaque still reports a large "contrast spread" purely from the hue difference. That would
 * have made this audit green on exactly the flat rail the member photographed. A side needs at
 * least a few beads before its spread means anything; below that it is dropped rather than
 * averaged in.
 */
function lumSpreadWithinSides(clusters) {
  const MIN_PER_SIDE = 4;
  let best = 0;
  let measured = false;
  for (const side of ["call", "put"]) {
    const lums = clusters
      .filter((c) => c.side === side)
      .map((c) => c.lumMean)
      .sort((a, b) => a - b);
    if (lums.length < MIN_PER_SIDE) continue;
    measured = true;
    best = Math.max(best, percentile(lums, 90) - percentile(lums, 10));
  }
  if (measured) return best;
  // Too few beads on either side to measure honestly — fall back to the whole set so the number is
  // still reported, and let the bead-count check carry the verdict.
  const all = clusters.map((c) => c.lumMean).sort((a, b) => a - b);
  return percentile(all, 90) - percentile(all, 10);
}

function summarizeBeads(clusters) {
  const radii = clusters.map((c) => c.radius).sort((a, b) => a - b);
  const lums = clusters.map((c) => c.lumMean).sort((a, b) => a - b);
  const p10 = percentile(radii, 10);
  const p50 = percentile(radii, 50);
  const p90 = percentile(radii, 90);
  return {
    count: clusters.length,
    callCount: clusters.filter((c) => c.side === "call").length,
    putCount: clusters.filter((c) => c.side === "put").length,
    radiusP10: round1(p10),
    radiusP50: round1(p50),
    radiusP90: round1(p90),
    // p90/p10 rather than max/min: one antialiased speck or one merged pair of overlapping beads
    // would dominate a raw extremum and make a flat rail look varied.
    radiusRatio: p10 > 0 ? round1(p90 / p10) : 0,
    lumP10: Math.round(percentile(lums, 10)),
    lumP90: Math.round(percentile(lums, 90)),
    lumSpread: Math.round(lumSpreadWithinSides(clusters)),
  };
}

/** Minimum bead count for a session rail to be considered rendered at all. */
const MIN_BEADS = 12;
/** Below this the sizes are effectively one value — the member's "all the beads are same". */
const MIN_RADIUS_RATIO = 1.4;
/** 0-255 luminance. Below this the fills are one contrast — "all beads same contrast". */
const MIN_LUM_SPREAD = 18;
/** A p50 radius under this is the #2310 failure: technically drawn, practically invisible. */
const MIN_MEDIAN_RADIUS = 2.0;

function verdictForTicker(s) {
  const notes = [];
  if (s.count < MIN_BEADS) {
    return {
      verdict: "RED",
      reason: `only ${s.count} beads rendered (expected >= ${MIN_BEADS})`,
      notes,
    };
  }
  let verdict = "GREEN";
  if (s.radiusP50 < MIN_MEDIAN_RADIUS) {
    verdict = "RED";
    notes.push(`median radius ${s.radiusP50}px is below the readable floor (${MIN_MEDIAN_RADIUS}px)`);
  }
  if (s.radiusRatio < MIN_RADIUS_RATIO) {
    verdict = "RED";
    notes.push(`size is flat (p90/p10 = ${s.radiusRatio}x, need >= ${MIN_RADIUS_RATIO}x)`);
  }
  if (s.lumSpread < MIN_LUM_SPREAD) {
    verdict = "RED";
    notes.push(`contrast is flat (luminance spread ${s.lumSpread}, need >= ${MIN_LUM_SPREAD})`);
  }
  // One side missing is not RED — a session can genuinely be one-sided — but it is worth saying
  // out loud, because the two sides are drawn by independent code paths.
  if (s.callCount === 0 || s.putCount === 0) {
    notes.push(`one-sided rail (call ${s.callCount} / put ${s.putCount})`);
    if (verdict === "GREEN") verdict = "AMBER";
  }
  if (!notes.length) notes.push("size and contrast both vary");
  return { verdict, notes };
}

module.exports = {
  classifyPixel,
  clusterBeadPixels,
  summarizeBeads,
  verdictForTicker,
  MIN_BEADS,
  MIN_RADIUS_RATIO,
  MIN_LUM_SPREAD,
  MIN_MEDIAN_RADIUS,
};
