import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";

/**
 * A workflow file's `run: |` block scalar ends the moment a non-blank line is indented less
 * than the block's own content — GitHub Actions then tries to parse whatever follows as a new
 * YAML node, and a stray shell fragment there fails with an obscure scanner error far from the
 * real line. `grid-rth-all-day-agent.yml` shipped exactly this: a `PROMPT="${BOOTSTRAP}\n\n${EXTRA}"`
 * split across three lines with the closing `${EXTRA}"` at column 0, which silently invalidated
 * the whole file. GitHub Actions accepted the push (this workflow has no `push` trigger to fail
 * loudly on) and just never ran it — every scheduled/dispatched invocation failed with zero jobs,
 * a `failure` conclusion, and no error visible anywhere except the raw YAML parse itself.
 */

const WORKFLOWS_DIR = join(import.meta.dirname, "..", ".github", "workflows");

test("every .github/workflows/*.yml file parses as valid YAML", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert.ok(files.length > 0, "expected to find workflow files to check");

  const failures: string[] = [];
  for (const file of files) {
    const path = join(WORKFLOWS_DIR, file);
    try {
      const doc = loadYaml(readFileSync(path, "utf8"));
      assert.ok(doc && typeof doc === "object", `${file}: parsed to a non-object document`);
    } catch (e) {
      failures.push(`${file}: ${(e as Error).message}`);
    }
  }

  assert.deepEqual(failures, [], `invalid workflow YAML:\n${failures.join("\n")}`);
});
