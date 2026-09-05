import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const toolbarSrc = readFileSync(
  join(process.cwd(), "src/features/largo/components/LargoTerminalToolbar.tsx"),
  "utf8"
);

test("LargoTerminalToolbar formatRelative rejects far-future timestamps (source scan)", () => {
  assert.match(
    toolbarSrc,
    /function formatRelative\(ts: number, now = Date\.now\(\)\)/,
    "formatRelative must accept injectable now for testability"
  );
  assert.match(
    toolbarSrc,
    /if \(rawDiff < -5_000\) return "—"/,
    "far-future history timestamps must not read as just now"
  );
  assert.match(toolbarSrc, /const diff = Math\.max\(0, rawDiff\)/);
});
