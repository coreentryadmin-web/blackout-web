import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = readFileSync(join(root, "src/features/spx/hooks/useMergedDesk.ts"), "utf8");

test(
  "deskStable ref starts undefined — a React #418 hydration-mismatch regression guard",
  () => {
    // /dashboard is the SPX desk route. deskStable used to initialize via
    // `useRef(readSessionCache(...))`, which reads sessionStorage during the render React
    // uses for hydration reconciliation. readSessionCache() returns undefined on the server
    // (no `window`) but a real cached desk on the client's first paint whenever the member
    // reloaded mid-session — and deskStable gates which of two structurally different trees
    // SpxDashboard renders (the loading skeleton vs. the full desk), so that divergence was a
    // guaranteed React error #418. Confirmed live 2026-09-01: 30 #418 crashes over 5 days,
    // 100% on /dashboard. See docs/audit/findings-staging/
    // 2026-09-01-spx-dashboard-hydration-crash-session-cache.md and the fix's own top-of-ref
    // comment in useMergedDesk.ts.
    assert.match(
      source,
      /const deskStable = useRef<SpxDeskPayload \| undefined>\(undefined\);/,
      "deskStable's useRef initial value must be the literal `undefined`, not " +
        "readSessionCache(...) evaluated during the hydration render"
    );
  }
);

test("deskStable is hydrated from sessionStorage post-mount, in an effect", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*const cached = readSessionCache<SpxDeskPayload>\(DESK_CACHE_KEY, DESK_CACHE_MAX_AGE_MS\);\s*if \(cached\) \{\s*deskStable\.current = cached;/,
    "the session cache must be read inside a useEffect (post-mount), not during render"
  );
});
