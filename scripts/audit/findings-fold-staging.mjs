#!/usr/bin/env node
// Folds every staged finding in docs/audit/findings-staging/*.md into docs/audit/FINDINGS.md,
// then deletes the staged files. See docs/audit/findings-staging/README.md for why this exists.
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { alreadyPresent } from "./lib/findings-entry-set.mjs";

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

// IDEMPOTENCY. This script had no duplicate check at all, so folding the same staged entry twice
// appended a second byte-identical copy — and `findings-no-loss.test.ts` then forbade removing
// either, so copies only ever accumulated (measured on `main`: one entry reached THREE). A staged
// entry already present verbatim is skipped and its file still deleted, because the file's whole
// job is to get its content into FINDINGS.md and that content is already there. An entry whose body
// has legitimately CHANGED is not byte-identical, so it still folds.
const duplicates = staged.filter((s) => alreadyPresent(src, s.content));
const fresh = staged.filter((s) => !alreadyPresent(src, s.content));
if (duplicates.length) {
  console.log(`Skipping ${duplicates.length} staged finding(s) already present verbatim in ${FINDINGS}:`);
  for (const d of duplicates) console.log(`  = ${d.file}`);
}
if (fresh.length === 0) {
  for (const s of staged) rmSync(join(STAGING_DIR, s.file));
  console.log("Nothing new to fold — every staged finding was already present.");
  process.exit(0);
}

const lines = src.split("\n");
const insertAt = lines.findIndex((l) => l.startsWith("## "));
if (insertAt === -1) {
  console.error(`Could not find an insertion point (no '## ' heading) in ${FINDINGS}`);
  process.exit(1);
}

const block = fresh.map((s) => s.content).join("\n\n") + "\n\n";
const before = lines.slice(0, insertAt).join("\n");
const after = lines.slice(insertAt).join("\n");
const merged = `${before}\n${block}${after}`;

writeFileSync(FINDINGS, merged.endsWith("\n") ? merged : `${merged}\n`);

for (const s of staged) rmSync(join(STAGING_DIR, s.file));

console.log(`Folded ${fresh.length} staged finding(s) into ${FINDINGS}:`);
for (const s of fresh) console.log(`  + ${s.file}`);
