import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = readFileSync(
  join(root, "src/features/spx/hooks/useStablePlayConfirmations.ts"),
  "utf8"
);

test(
  "stableRef starts null — a React #418 hydration-mismatch regression guard",
  () => {
    // Same defect class as useMergedDesk.ts's deskStable ref: `useRef(loadLayer())` reads
    // sessionStorage during the render React uses for hydration, diverging from the server
    // (always null, no `window`) whenever a cached confirmation layer exists client-side.
    // Currently dead code (SpxTradeAlerts, this hook's only consumer, isn't mounted on the
    // flagship desk) but fixed for correctness rather than left latent.
    assert.match(
      source,
      /const stableRef = useRef<PlayConfirmationLayer \| null>\(null\);/,
      "stableRef's useRef initial value must be the literal `null`, not loadLayer() " +
        "evaluated during the hydration render"
    );
  }
);

test("stableRef is hydrated from sessionStorage post-mount, in an effect", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*const cached = loadLayer\(\);\s*if \(cached\) \{\s*stableRef\.current = cached;/,
    "the session cache must be read inside a useEffect (post-mount), not during render"
  );
});
