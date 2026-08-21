#!/usr/bin/env node
/**
 * THE test runner — the one command CI and a developer both run.
 *
 * WHY THIS EXISTS. `npm test` used to be:
 *
 *     node --import tsx --experimental-test-module-mocks --test "src/ ** / *.test.ts"
 *
 * which only finds anything on Node 22+, because expanding a glob inside `--test` is a Node 22
 * feature. CI runs Node 20 (so does production — `node:20-bookworm-slim`), so it could not use
 * that line and expanded the glob itself in bash instead. The result was two DIFFERENT commands
 * wearing one name: a local `npm test` was never the run that gates the merge.
 *
 * That gap is not theoretical. #2073 was a Dependabot bump whose CI failed 133 tests while the
 * identical tree passed locally; the cause was a tsx resolver that only breaks under Node 20, and
 * the local run could not have caught it. Chasing that took a full investigation that a matching
 * runtime would have made unnecessary.
 *
 * So: expand the glob HERE, in JavaScript, where the behaviour does not depend on the Node version
 * or the shell. Both callers now execute the same argv.
 *
 * THE VERSION CHECK IS A WARNING, NOT A GATE. Refusing to run on Node 22 would block the one thing
 * a developer on the wrong runtime should still be able to do — run the tests and see most of the
 * truth. What it must not do is let them believe a green local run means CI is green. So it prints
 * a loud banner naming the exact risk, and exits with the test process's own status.
 *
 * Extra CLI args are forwarded to node, before the file list (e.g. `npm test -- --test-name-pattern=x`).
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const TEST_DIR = join(REPO_ROOT, "src");
/**
 * The audit harnesses and deploy tooling keep their unit tests beside the code, under scripts/.
 * They were collected by NOTHING — not this runner, not any workflow, not any npm script — so
 * 32 test files gated no merge. CLAUDE.md describes several of those helpers as "unit-tested",
 * which was true of the files and false of the pipeline.
 *
 * Two of them had already rotted silently by the time this was noticed: bead-pixel-eval's test
 * still asserted the cyan/red palette its own lib was corrected away from months earlier, and
 * x-marketing-paused's test read LIVE production secrets and passed only where AWS was
 * unreachable. Both are fixed in the same change that adds this directory.
 *
 * `.mjs`/`.mts` are included here because that is what the audit libs are written in; src/ is
 * TypeScript-only and stays that way.
 */
const SCRIPTS_TEST_DIR = join(REPO_ROOT, "scripts");

/** The Node major CI and the production image both run. Keep in sync with .nvmrc / Dockerfile. */
const EXPECTED_NODE_MAJOR = 20;

/** Test files under `dir`, sorted so a run is reproducible and diffable across machines. */
function collectTestFiles(dir, exts = [".test.ts"]) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      found.push(...collectTestFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      found.push(full);
    }
  }
  return found;
}

const runningMajor = Number(process.versions.node.split(".")[0]);
if (runningMajor !== EXPECTED_NODE_MAJOR) {
  // Not a failure — but a green run here does NOT predict CI, and that must not be discoverable
  // only after a merge. See the tsx/#2073 case above.
  console.warn(
    [
      "",
      "  ⚠  NODE VERSION MISMATCH",
      `     running Node ${process.versions.node}, but CI and production run Node ${EXPECTED_NODE_MAJOR}.x`,
      "     A pass here does NOT mean CI passes: module-resolution and test-runner behaviour",
      "     differ between majors (this is exactly how the tsx breakage in #2073 slipped past a",
      "     local run). Use `nvm use` to match .nvmrc before trusting this result.",
      "",
    ].join("\n")
  );
}

const srcFiles = collectTestFiles(TEST_DIR).sort();
if (srcFiles.length === 0) {
  console.error(`No *.test.ts files found under ${relative(REPO_ROOT, TEST_DIR)} — refusing to report success.`);
  process.exit(1);
}
const scriptFiles = collectTestFiles(SCRIPTS_TEST_DIR, [".test.ts", ".test.mjs", ".test.mts"]).sort();
if (scriptFiles.length === 0) {
  // Same refusal as src/: a collector that silently finds nothing reports a clean pass, which is
  // exactly the failure this directory was added to end.
  console.error(`No test files found under ${relative(REPO_ROOT, SCRIPTS_TEST_DIR)} — refusing to report success.`);
  process.exit(1);
}
const files = [...srcFiles, ...scriptFiles];
console.log(
  `Running ${files.length} test files on Node ${process.versions.node} ` +
    `(${srcFiles.length} under src/, ${scriptFiles.length} under scripts/)`
);

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--experimental-test-module-mocks", "--test", ...process.argv.slice(2), ...files],
  { stdio: "inherit", cwd: REPO_ROOT, env: { PLAYBOOK_VERDICT_GUARD_ASSERT: "1", ...process.env } }
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
