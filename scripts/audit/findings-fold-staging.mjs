#!/usr/bin/env node
// Folds every staged finding in docs/audit/findings-staging/*.md into docs/audit/FINDINGS.md,
// then deletes the staged files. See docs/audit/findings-staging/README.md for why this exists.
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const STAGING_DIR = process.env.FINDINGS_STAGING_DIR ?? "docs/audit/findings-staging";
const FINDINGS = process.env.FINDINGS_STAGING_TARGET ?? "docs/audit/FINDINGS.md";

const files = readdirSync(STAGING_DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort()
  .reverse(); // date-prefixed filenames — newest first, matching FINDINGS.md's own convention

if (files.length === 0) {
  console.log("No staged findings to fold.");
  process.exit(0);
}

const staged = files.map((f) => ({
  file: f,
  content: readFileSync(join(STAGING_DIR, f), "utf8").trimEnd(),
}));

const bad = staged.filter((s) => !/^## \d{4}-\d{2}-\d{2} — \[/.test(s.content));
if (bad.length) {
  console.error(
    "Refusing to fold — these staged files do not start with a '## YYYY-MM-DD — [...]' heading:"
  );
  for (const b of bad) console.error(`  ${b.file}`);
  process.exit(1);
}

const src = readFileSync(FINDINGS, "utf8");
const lines = src.split("\n");
const insertAt = lines.findIndex((l) => l.startsWith("## "));
if (insertAt === -1) {
  console.error(`Could not find an insertion point (no '## ' heading) in ${FINDINGS}`);
  process.exit(1);
}

const block = staged.map((s) => s.content).join("\n\n") + "\n\n";
const before = lines.slice(0, insertAt).join("\n");
const after = lines.slice(insertAt).join("\n");
const merged = `${before}\n${block}${after}`;

writeFileSync(FINDINGS, merged.endsWith("\n") ? merged : `${merged}\n`);

for (const s of staged) rmSync(join(STAGING_DIR, s.file));

console.log(`Folded ${staged.length} staged finding(s) into ${FINDINGS}:`);
for (const s of staged) console.log(`  + ${s.file}`);
