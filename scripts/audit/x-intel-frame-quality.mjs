#!/usr/bin/env node
/**
 * Score captured X attachments against the Screenshot Playbook's reject list.
 *
 * The playbook's composition rules were prose, which means they were applied by whoever remembered
 * to. Every one of them is a measurable property of the PNG, so this measures them. Pure helpers
 * live in `lib/frame-quality-eval.cjs` and are unit-tested against synthetic images.
 *
 *   node scripts/audit/x-intel-frame-quality.mjs shot.png [more.png ...]
 *   node scripts/audit/x-intel-frame-quality.mjs --json /tmp/shots/*.png
 *
 * Exit code is 1 if any frame fails, so it can gate a package before it reaches the queue.
 */
import sharp from "sharp";
import { scoreFrame } from "./lib/frame-quality-eval.cjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: x-intel-frame-quality.mjs <png...> [--json]");
  process.exit(2);
}

const rows = [];
for (const file of files) {
  try {
    const img = sharp(file);
    const { width, height } = await img.metadata();
    const rgba = await img.ensureAlpha().raw().toBuffer();
    const s = scoreFrame(rgba, width, height);
    rows.push({ file, width, height, ...s });
  } catch (e) {
    rows.push({ file, error: String(e.message).slice(0, 120), pass: false, rejects: ["unreadable file"] });
  }
}

if (json) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const name = (f) => f.split("/").pop().padEnd(26);
  console.log("frame                       size        ink   dead  empty  legib  aspect   verdict");
  for (const r of rows) {
    if (r.error) { console.log(`${name(r.file)} ERROR ${r.error}`); continue; }
    console.log(
      `${name(r.file)}${String(r.width + "x" + r.height).padEnd(12)}` +
        `${(r.ink * 100).toFixed(1).padStart(5)}%` +
        `${(r.band.fraction * 100).toFixed(0).padStart(5)}%` +
        `${(r.emptyCells * 100).toFixed(0).padStart(6)}%` +
        `${r.legibility.toFixed(2).padStart(7)}` +
        `${r.aspect.ratio.toFixed(2).padStart(8)}  ` +
        (r.pass ? "PASS" : "REJECT"),
    );
    for (const x of r.rejects) console.log(`${" ".repeat(28)}✗ ${x}`);
    for (const x of r.warnings ?? []) console.log(`${" ".repeat(28)}! ${x}`);
  }
  const failed = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failed}/${rows.length} pass`);
}
process.exit(rows.some((r) => !r.pass) ? 1 : 0);
