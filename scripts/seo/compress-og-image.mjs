#!/usr/bin/env node
/** Recompress public/og-image.png for faster social/CDN delivery. */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.cwd(), "public/og-image.png");
const before = readFileSync(path).length;

const buf = await sharp(path)
  .png({ compressionLevel: 9, palette: false, quality: 82, effort: 10 })
  .toBuffer();

if (buf.length >= before) {
  console.log(`og-image.png already optimal (${before} bytes)`);
  process.exit(0);
}

writeFileSync(path, buf);
console.log(`og-image.png ${before} → ${buf.length} bytes (${Math.round((1 - buf.length / before) * 100)}% smaller)`);
