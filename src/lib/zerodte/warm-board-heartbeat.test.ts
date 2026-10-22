import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("warmZeroDteBoard records scan heartbeat before awaiting scanZeroDteBoard (long-run liveness)", () => {
  const src = readFileSync(fileURLToPath(new URL("./scan.ts", import.meta.url)), "utf8");
  const fn = src.match(/export async function warmZeroDteBoard\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn, "warmZeroDteBoard() not found");
  const startIdx = fn.indexOf("recordZeroDteScanTick");
  const scanIdx = fn.indexOf("await scanZeroDteBoard()");
  assert.ok(startIdx >= 0 && scanIdx > startIdx, "start tick must precede scanZeroDteBoard await");
});
