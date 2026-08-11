/**
 * FONT COVERAGE — does a committed face actually contain a codepoint?
 *
 * WHY THIS EXISTS. satori does not error on a glyph its supplied font buffers cannot draw. It
 * falls back to `loadAdditionalAsset`, which DOWNLOADS A GOOGLE FONT over the network, at render
 * time, on the request path. So a single character outside the committed faces silently converts
 * a pure local render into an outbound HTTP call — slower, dependent on egress the web container
 * may not have, and when it fails the character simply disappears from the card.
 *
 * That is invisible in code review and invisible in the rendered output (a missing separator glyph
 * looks like a design choice), which is exactly the profile of bug that needs a machine to catch
 * it. `tokens.test.ts` uses this to assert every `GLYPH` codepoint is present in all three faces.
 *
 * The reader handles cmap subtable formats 4 (BMP) and 12 (full range), which is what the three
 * committed TTFs use. An unrecognised format contributes nothing rather than throwing — a face
 * whose tables cannot be read reports as covering nothing, which fails the test loudly rather than
 * passing it vacuously.
 */

import { readFileSync } from "node:fs";

export function fontCodepoints(path: string): Set<number> {
  const b = readFileSync(path);
  const set = new Set<number>();

  const numTables = b.readUInt16BE(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    if (b.toString("ascii", p, p + 4) === "cmap") cmapOff = b.readUInt32BE(p + 8);
  }
  if (!cmapOff) return set;

  const subtables = b.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < subtables; i++) {
    const sub = cmapOff + b.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    if (sub + 4 > b.length) continue;
    const format = b.readUInt16BE(sub);

    if (format === 4) {
      const segX2 = b.readUInt16BE(sub + 6);
      const segments = segX2 / 2;
      const endO = sub + 14;
      const startO = endO + segX2 + 2;
      const deltaO = startO + segX2;
      const rangeO = deltaO + segX2;
      for (let s = 0; s < segments; s++) {
        const end = b.readUInt16BE(endO + s * 2);
        const start = b.readUInt16BE(startO + s * 2);
        if (start === 0xffff) continue; // terminator segment
        const delta = b.readInt16BE(deltaO + s * 2);
        const rangeOffset = b.readUInt16BE(rangeO + s * 2);
        for (let c = start; c <= end && c !== 0x10000; c++) {
          let glyph: number;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            const gi = rangeO + s * 2 + rangeOffset + (c - start) * 2;
            if (gi + 1 >= b.length) continue;
            glyph = b.readUInt16BE(gi);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          // Glyph id 0 is `.notdef` — mapped, but it is the tofu box, not coverage.
          if (glyph) set.add(c);
        }
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const o = sub + 16 + g * 12;
        if (o + 12 > b.length) break;
        const startChar = b.readUInt32BE(o);
        const endChar = b.readUInt32BE(o + 4);
        for (let c = startChar; c <= endChar; c++) set.add(c);
      }
    }
  }
  return set;
}

/** Codepoints in `text` that `path` cannot draw. Empty means the face covers every character. */
export function missingCodepoints(path: string, text: string): number[] {
  const have = fontCodepoints(path);
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (!have.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
