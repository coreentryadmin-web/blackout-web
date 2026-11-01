import test from "node:test";
import assert from "node:assert/strict";
import * as api from "./api";

// `fetchPlatformHealth`/`PlatformHealth` were removed 2026-10-31: a client-side merge of
// `/api/market/health` + `/api/engine/health` with zero importers anywhere in the repo since
// the original dashboard migration commit (c33d302b0) that introduced it — confirmed by a
// repo-wide grep for both names returning only the definition site itself. Both underlying
// routes remain real/registered (`route-registry.ts`, `cursor-api-analysis-data.ts`); only this
// unused client wrapper was dead. Locks the name out of the module's runtime surface so a future
// edit can't silently resurrect unused scaffolding without a deliberate, reviewed change here —
// if a real caller needs this again, add it in the same PR rather than restoring dead code.
test("fetchPlatformHealth dead export stays removed from api.ts's runtime surface", () => {
  assert.equal(
    (api as Record<string, unknown>).fetchPlatformHealth,
    undefined,
    "fetchPlatformHealth should not be re-exported from src/lib/api.ts without a real caller",
  );
});
