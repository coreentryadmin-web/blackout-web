import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { etSessionDate } from "@/lib/largo/temporal/bar-session-date";

// `./index.ts` statically imports the SPX service, which transitively imports
// `gex-positioning.ts` (`import "server-only"`), which throws under plain Node outside a
// Next.js server bundle — same pattern as src/app/api/market/gex-heatmap/route.test.ts and
// its siblings. Must be intercepted before index.ts's own static imports ever load it.
mock.module("server-only", { namedExports: {} });

// Regression (Largo C1 session-anchor known gap, src/lib/largo/contract/session-anchor.test.ts):
// `getPlatformSnapshot` stamped only a bare UTC `as_of` instant on the top-level cross-service
// wrapper, with no ET session anchor beside it — even though `flows.session_date` (a sub-object
// one level down) already carried one. `get_platform_snapshot` is a direct Largo tool
// (src/lib/largo/run-tool.ts), so a model resolving "today" from `as_of`'s own UTC calendar date
// reads a full session ahead for the last ~4 hours of RTH (after ~20:00 ET) — the same inversion
// class fixed in #2418/#2420/#2422.
//
// `include: []` skips every per-service fetch (no DB/network needed for this unit) so the test
// is isolated to the wrapper's own stamping logic.
test("getPlatformSnapshot anchors the top-level as_of wrapper stamp with an ET session_date", async () => {
  const { getPlatformSnapshot } = await import("./index.ts");

  const before = Date.now();
  const snapshot = await getPlatformSnapshot({ include: [] });
  const after = Date.now();

  assert.equal(typeof snapshot.as_of, "string");
  const asOfMs = Date.parse(snapshot.as_of);
  assert.ok(asOfMs >= before && asOfMs <= after, "as_of must be a real, current instant");

  assert.equal(
    snapshot.session_date,
    etSessionDate(asOfMs),
    "session_date must anchor the SAME instant as_of carries, via the shared etSessionDate helper"
  );
  assert.match(snapshot.session_date ?? "", /^\d{4}-\d{2}-\d{2}$/);
});
