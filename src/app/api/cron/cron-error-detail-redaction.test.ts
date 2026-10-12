import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards against a cron route's catch block echoing the caught error's own message back in its
 * HTTP JSON response (vs. a generic string). The 2026-07-29 "[Security] Medium hygiene" finding
 * fixed this across ~14 cron routes (HTTP bodies no longer echo `err.message`/`detail`, while
 * `logCronRun`'s own internal log line still keeps the detail for ops) — but `x-intel/route.ts`
 * (added 2026-08-24, after that sweep) shipped the exact same leak un-fixed: its catch block
 * returned `{ ok: false, error: "X intel generation failed", detail: message }`, putting the raw
 * exception text straight into the cron's authenticated HTTP response. A new cron route added
 * after the original sweep has no reason to inherit that fix, so this scans every current and
 * future `src/app/api/cron/*\/route.ts` rather than re-checking the original ~14 by name.
 *
 * Heuristic: within each file, find every caught-error variable assigned via
 * `X instanceof Error ? X.message : ...` inside a catch block, then assert that identifier never
 * appears as a `NextResponse.json({...})` property VALUE (a bare identifier, not a quoted
 * string literal) anywhere after that point in the file. A generic string message as the value
 * is fine; the bound identifier itself leaking through is the bug.
 */
function tracked(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
}

const REPO = join(import.meta.dirname, "..", "..", "..", "..");

test("no cron route echoes its caught error's message/detail back in its HTTP JSON response", () => {
  const files = tracked().filter(
    (p) => /^src\/app\/api\/cron\/.*\/route\.ts$/.test(p) && !p.endsWith(".test.ts")
  );
  assert.ok(files.length > 10, "sanity: expected well over 10 cron route files");

  const violations: string[] = [];
  for (const file of files) {
    const src = readFileSync(join(REPO, file), "utf8");
    // Matches: const <id> = <expr> instanceof Error ? <expr>.message : ...
    const bindingRe = /const\s+(\w+)\s*=\s*\w+\s+instanceof\s+Error\s*\?\s*\w+\.message\s*:/g;
    const boundNames = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = bindingRe.exec(src))) boundNames.add(m[1]!);
    if (boundNames.size === 0) continue;

    // Scope the check to the actual HTTP response calls, not every object literal in the file
    // (logCronRun(...)'s own internal-logging call legitimately carries `error: message`).
    const jsonCallRe = /NextResponse\.json\(([\s\S]*?)\);/g;
    let call: RegExpExecArray | null;
    while ((call = jsonCallRe.exec(src))) {
      const body = call[1]!;
      for (const name of boundNames) {
        // A bare-identifier property value for a detail/error/message-shaped key, e.g.
        // `detail: message`, `error: err` — but not `error: "some string"`.
        const leakRe = new RegExp(`\\b(detail|error|message)\\s*:\\s*${name}\\b`);
        if (leakRe.test(body)) {
          violations.push(`${file}: caught-error identifier "${name}" appears in a NextResponse.json(...) call`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], `cron routes leaking error detail into their HTTP response:\n  ${violations.join("\n  ")}`);
});
