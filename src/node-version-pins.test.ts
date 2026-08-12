import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE NODE MAJOR IS PINNED IN FIVE PLACES — this test is what keeps them one number.
 *
 * The production image is `node:20-bookworm-slim`. CI pins `node-version: 20`. `.nvmrc` says 20.
 * `package.json` engines allows only 20.x. `scripts/run-tests.mjs` warns against anything else.
 * Any one of those drifting on its own reintroduces the exact failure mode this pinning exists to
 * prevent: a test run that passes on one runtime and fails on the other, discovered only in CI —
 * see #2073, where a tsx bump broke 133 tests under Node 20 while passing under Node 22.
 *
 * These are cheap string reads, deliberately: a guard that needs the toolchain installed to run is
 * a guard that gets skipped.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const EXPECTED_MAJOR = 20;

test(".nvmrc names the major production actually runs", () => {
  const nvmrc = readFileSync(join(REPO_ROOT, ".nvmrc"), "utf8").trim();
  assert.equal(nvmrc, String(EXPECTED_MAJOR), ".nvmrc must match the deploy image's Node major");
});

test("the production Dockerfile is built on that same major", () => {
  const dockerfile = readFileSync(join(REPO_ROOT, "deploy/Dockerfile"), "utf8");
  const base = /^FROM node:(\d+)/m.exec(dockerfile);
  assert.ok(base, "deploy/Dockerfile must pin an explicit node:<major> base image");
  assert.equal(
    Number(base[1]),
    EXPECTED_MAJOR,
    "the image members' code runs on is the version every other pin has to follow"
  );
});

test("package.json admits that major and no other", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    engines?: { node?: string };
  };
  const range = pkg.engines?.node ?? "";
  assert.match(range, new RegExp(`>=${EXPECTED_MAJOR}\\.`), "engines.node must floor at the pinned major");
  assert.match(
    range,
    new RegExp(`<${EXPECTED_MAJOR + 1}`),
    "engines.node must also CEIL — an open-ended range is how a Node 22 local run started passing " +
      "against a Node 20 CI in the first place"
  );
});

test("every workflow that sets up Node asks for that major — no stragglers", () => {
  const dir = join(REPO_ROOT, ".github/workflows");
  const offenders: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const body = readFileSync(join(dir, file), "utf8");
    for (const m of body.matchAll(/node-version:\s*["']?(\d+)/g)) {
      if (Number(m[1]) !== EXPECTED_MAJOR) offenders.push(`${file} -> ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], "these workflows would run a different Node than production");
});

test("the test runner enforces the same number it documents", () => {
  const runner = readFileSync(join(REPO_ROOT, "scripts/run-tests.mjs"), "utf8");
  const declared = /EXPECTED_NODE_MAJOR\s*=\s*(\d+)/.exec(runner);
  assert.ok(declared, "run-tests.mjs must declare the expected major as a constant");
  assert.equal(Number(declared[1]), EXPECTED_MAJOR);
});

test("npm test goes through the shared runner, not a raw glob only one Node can expand", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts?: { test?: string };
  };
  const script = pkg.scripts?.test ?? "";
  assert.match(script, /run-tests\.mjs/, "`npm test` must be the same entrypoint CI runs");
  assert.doesNotMatch(
    script,
    /--test\s+["']?src\/\*\*/,
    "passing a glob straight to --test silently matches NOTHING on Node 20"
  );
});

test("CI invokes that entrypoint rather than re-implementing it in bash", () => {
  const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /run:\s*npm test/, "the verify job must run the same command a developer runs");
  assert.doesNotMatch(
    ci,
    /shopt -s globstar/,
    "a bash-side glob expansion is a second, divergent runner — that divergence is the bug"
  );
});
