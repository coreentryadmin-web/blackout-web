import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const src = readFileSync(new URL("./LargoTerminalToolbar.tsx", import.meta.url), "utf8");

describe("LargoTerminalToolbar.formatRelative", () => {
  test("guards future timestamps beyond clock-skew tolerance", () => {
    assert.match(
      src,
      /if \(diff < -5_000\) return "clock skew"/,
      "future history timestamps must not read as just now"
    );
  });
});
