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

/** The Node major CI and the production image both run. Keep in sync with .nvmrc / Dockerfile. */
const EXPECTED_NODE_MAJOR = 20;

/** Every `*.test.ts` under src/, sorted so a run is reproducible and diffable across machines. */
function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      found.push(...collectTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
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

const files = collectTestFiles(TEST_DIR).sort();
if (files.length === 0) {
  console.error(`No *.test.ts files found under ${relative(REPO_ROOT, TEST_DIR)} — refusing to report success.`);
  process.exit(1);
}
console.log(`Running ${files.length} test files on Node ${process.versions.node}`);

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--experimental-test-module-mocks", "--test", ...process.argv.slice(2), ...files],
  { stdio: "inherit", cwd: REPO_ROOT, env: { PLAYBOOK_VERDICT_GUARD_ASSERT: "1", ...process.env } }
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
