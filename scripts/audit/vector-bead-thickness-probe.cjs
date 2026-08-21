/**
 * How THICK is a bead row, measured against the space it has to live in?
 *
 * Member report (2026-08-19, live RTH): "dont you think it paints too hard like too thick for the
 * strong nodes" — with the strongest SPX rows circled, painting as slabs that swallow the candles.
 *
 * WHY NOT REUSE THE PIXEL AUDIT'S RADIUS. `clusterBeadPixels` reports a blob radius, and along one
 * strike the consecutive buckets MERGE into a single long horizontal run. Its radius is then
 * dominated by the run's LENGTH IN TIME, not by the bead's height. Read as thickness it is simply
 * wrong: it reported p90 = 50px on SPY, which would be a 100px-tall bead on a pane whose entire
 * strike ladder spans ~40px per row. That misreading was made once already in this investigation
 * and corrected here rather than repeated.
 *
 * So this measures the only thing the complaint is about: for each painted ROW, the VERTICAL extent
 * of its colored band, expressed as a fraction of the gap to the nearest neighbouring row. A value
 * near 1.0 means the row fills its entire slot — rows touch, the rail reads as a slab, and whatever
 * is behind it is hidden. The reference implementation a member supplied runs visibly under 0.5.
 *
 * Rows are found by their own hue (call beads vs put beads are separate code paths and a regression
 * in one reads as "half the chart is fine"), and candle pixels are excluded by hue so a red/green
 * bar is never counted as bead thickness.
 *
 * Read-only, offline: it analyses PNGs already captured. No network, no auth, no secrets.
 *
 * Run from the REPO ROOT:
 *   node scripts/audit/vector-bead-thickness-probe.cjs --shots=/tmp/shots/rth20 [--json]
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SHOTS = arg("shots", ".");
const JSON_OUT = argv.includes("--json");

/** Classify a pixel as a call bead (yellow), a put bead (magenta), or neither. Candles are
 *  red/green and the grid is grey — both fall out of these two tests. */
function beadClass(r, g, b, a) {
  if (a < 60) return null;
  const mx = Math.max(r, g, b);
  if (mx < 80) return null;
  // Yellow: red and green both high, blue low.
  if (r > 120 && g > 100 && b < Math.min(r, g) * 0.62) return "call";
  // Magenta: red and blue both high, green clearly lower.
  if (r > 110 && b > 110 && g < Math.min(r, b) * 0.72) return "put";
  return null;
}

function analyze(file) {
  const sharp = require("sharp");
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
    const { width: w, height: h, channels: ch } = info;
    // Per-scanline bead pixel counts, per side.
    const rowCount = { call: new Array(h).fill(0), put: new Array(h).fill(0) };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * ch;
        const c = beadClass(data[i], data[i + 1], data[i + 2], ch === 4 ? data[i + 3] : 255);
        if (c) rowCount[c][y]++;
      }
    }
    const out = {};
    for (const side of ["call", "put"]) {
      const counts = rowCount[side];
      // A scanline belongs to a row band if it carries a meaningful share of the max — a hard
      // threshold on absolute count would scale with how long the run is, not how thick it is.
      const peak = Math.max(...counts);
      if (peak <= 0) { out[side] = { bands: [], rows: 0 }; continue; }
      const thresh = Math.max(2, peak * 0.12);
      const bands = [];
      let start = -1;
      for (let y = 0; y < h; y++) {
        const on = counts[y] >= thresh;
        if (on && start < 0) start = y;
        if ((!on || y === h - 1) && start >= 0) {
          const end = on ? y : y - 1;
          bands.push({ top: start, bottom: end, thickness: end - start + 1, centre: (start + end) / 2 });
          start = -1;
        }
      }
      // Gap to the NEAREST neighbouring band centre — the space this row actually has.
      for (let i = 0; i < bands.length; i++) {
        const prev = i > 0 ? bands[i - 1].centre : null;
        const next = i < bands.length - 1 ? bands[i + 1].centre : null;
        const gaps = [prev, next].filter((v) => v != null).map((v) => Math.abs(bands[i].centre - v));
        bands[i].rowGap = gaps.length ? Math.min(...gaps) : null;
        bands[i].fill = bands[i].rowGap ? bands[i].thickness / bands[i].rowGap : null;
      }
      out[side] = { bands, rows: bands.length };
    }
    return out;
  });
}

const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(f * (s.length - 1))] : null; };

(async () => {
  const files = fs.readdirSync(SHOTS).filter((f) => f.endsWith(".png")).sort();
  if (!files.length) { console.error(`no PNGs in ${SHOTS}`); process.exit(2); }
  const rows = [];
  for (const f of files) {
    try {
      const res = await analyze(path.join(SHOTS, f));
      const all = [...res.call.bands, ...res.put.bands].filter((b) => b.fill != null);
      if (!all.length) { rows.push({ file: f, rows: 0 }); continue; }
      const fills = all.map((b) => b.fill);
      const thick = all.map((b) => b.thickness);
      const gaps = all.map((b) => b.rowGap);
      rows.push({
        file: f,
        rows: res.call.rows + res.put.rows,
        thickP50: q(thick, 0.5), thickP90: q(thick, 0.9), thickMax: Math.max(...thick),
        gapP50: q(gaps, 0.5),
        fillP50: q(fills, 0.5), fillP90: q(fills, 0.9), fillMax: Math.max(...fills),
      });
    } catch (e) {
      rows.push({ file: f, error: String(e?.message || e).slice(0, 80) });
    }
  }

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log("BEAD THICKNESS vs ROW SPACING — fill = band thickness / nearest row gap");
  console.log("file                              rows  thick p50/p90/max  gap p50   fill p50/p90/max");
  for (const r of rows) {
    if (r.error) { console.log(`${r.file.padEnd(33)} ERROR ${r.error}`); continue; }
    if (!r.rows) { console.log(`${r.file.padEnd(33)} no bead rows detected`); continue; }
    console.log(
      `${r.file.padEnd(33)} ${String(r.rows).padStart(4)}  ` +
      `${String(r.thickP50).padStart(4)}/${String(r.thickP90).padStart(4)}/${String(r.thickMax).padStart(4)}px  ` +
      `${String(Math.round(r.gapP50)).padStart(5)}px  ` +
      `${r.fillP50.toFixed(2)}/${r.fillP90.toFixed(2)}/${r.fillMax.toFixed(2)}` +
      (r.fillP90 > 0.75 ? "   <- rows nearly touch (slab)" : "")
    );
  }
  const ok = rows.filter((r) => r.fillP90 != null);
  if (ok.length) {
    const worst = ok.slice().sort((a, b) => b.fillP90 - a.fillP90)[0];
    console.log("");
    console.log(`frames: ${ok.length} | median fill p90: ${q(ok.map((r) => r.fillP90), 0.5).toFixed(2)} | worst: ${worst.file} at ${worst.fillP90.toFixed(2)}`);
    console.log("reference implementation (member screenshot) runs visibly under 0.50");
  }
})().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });
