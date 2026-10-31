import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: polygon-socket.ts's indices WS URL default must come from the shared
// `MASSIVE_WS_INDICES` constant (src/lib/polygon-docs-nav.ts) — exactly the same wiring
// its two siblings already use (stocks-socket.ts -> MASSIVE_WS_STOCKS,
// options-socket.ts -> MASSIVE_WS_OPTIONS). Previously it duplicated the URL as a bare
// hardcoded literal instead of importing the constant, so a future change to the shared
// value (e.g. a Massive endpoint migration) would update two of the three WS clients and
// silently miss the indices one.
const src = readFileSync(join(process.cwd(), "src/lib/ws/polygon-socket.ts"), "utf8");

test("polygon-socket imports the shared MASSIVE_WS_INDICES constant (source scan)", () => {
  assert.match(
    src,
    /import\s*\{\s*MASSIVE_WS_INDICES\s*\}\s*from\s*["']@\/lib\/polygon-docs-nav["']/,
    "polygon-socket.ts must import MASSIVE_WS_INDICES from @/lib/polygon-docs-nav, " +
      "matching stocks-socket.ts/options-socket.ts's own MASSIVE_WS_* wiring"
  );
});

test("polygon-socket's indices WS default references the imported constant, not a duplicated literal", () => {
  assert.match(
    src,
    /POLYGON_WS_INDICES\s*=\s*process\.env\.POLYGON_WS_INDICES\s*\?\?\s*MASSIVE_WS_INDICES/,
    "the env-var fallback must read MASSIVE_WS_INDICES, not a hardcoded wss:// literal"
  );
  assert.doesNotMatch(
    src,
    /["']wss:\/\/socket\.massive\.com\/indices["']/,
    "the indices WS URL must not be duplicated inline once the shared constant is imported"
  );
});
