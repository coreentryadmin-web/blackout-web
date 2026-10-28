import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateProviderHealth,
  summarizeDocumentationCoverage,
  type RegistryEndpointRow,
} from "./admin-endpoint-registry";

function row(overrides: Partial<RegistryEndpointRow> & Pick<RegistryEndpointRow, "provider" | "documented" | "usedInCode">): RegistryEndpointRow {
  return {
    id: `${overrides.provider}|${overrides.pathTemplate ?? "/x"}`,
    providerLabel: overrides.provider,
    section: "docs",
    name: "x",
    path: "/x",
    pathTemplate: "/x",
    sourceFiles: [],
    catalogUsedBy: [],
    catalogDescription: null,
    probeStatus: "unknown",
    probeHttp: null,
    probeMs: null,
    probeNote: null,
    probeBlocked: false,
    telemetry: null,
    runtimeStatus: "unknown",
    integrationCandidate: false,
    productionRisk: false,
    ...overrides,
  };
}

// Regression (DISCOVERY-lane live-UI sweep, 2026-10-26): /admin?tab=apis live showed the
// "anthropic" and "blackout engine" provider chips reading "1/0 used" -- more used than
// documented, a mathematically backwards fraction for a label that reads "{used}/{documented}
// used". Root cause: usedTotal/usedInCode counted EVERY row with usedInCode:true, including rows
// discovered only via a codebase scan (documented:false, always usedInCode:true -- see
// buildEndpointRegistry's "codeOnlyPaths" loop), which are not a subset of the documented rows
// the denominator counts. The same ungated count fed the top-level "Coverage" ring
// (used_in_code / documented_total), inflating it live: DOCUMENTED 265 / IN CODE 213 / UNUSED 73
// (213 + 73 = 286 != 265, a 21-row leak) -- shown as 80.4% Coverage, honestly 192/265 = 72.5%.
test("aggregateProviderHealth: usedTotal/unusedTotal only count documented rows, never code-only discoveries", () => {
  const rows: RegistryEndpointRow[] = [
    // anthropic: zero documented endpoints, one code-only call site -- must read 0/0, not 1/0.
    row({ provider: "anthropic", documented: false, usedInCode: true, pathTemplate: "/v1/messages" }),
    // polygon: one documented+used, one documented+unused -- must read 1/2, not 2/2.
    row({ provider: "polygon", documented: true, usedInCode: true, pathTemplate: "/v2/a" }),
    row({ provider: "polygon", documented: true, usedInCode: false, pathTemplate: "/v2/b" }),
  ];

  const health = aggregateProviderHealth(rows, () => true);
  const anthropic = health.find((p) => p.id === "anthropic");
  const polygon = health.find((p) => p.id === "polygon");

  assert.ok(anthropic);
  assert.equal(anthropic!.documentedTotal, 0);
  assert.equal(anthropic!.usedTotal, 0, "code-only discovery must not inflate usedTotal past documentedTotal");
  assert.equal(anthropic!.unusedTotal, 0);

  assert.ok(polygon);
  assert.equal(polygon!.documentedTotal, 2);
  assert.equal(polygon!.usedTotal, 1);
  assert.equal(polygon!.unusedTotal, 1);
});

test("summarizeDocumentationCoverage: usedInCode never exceeds documentedTotal (the Coverage-ring fraction stays honest)", () => {
  const rows: RegistryEndpointRow[] = [
    row({ provider: "anthropic", documented: false, usedInCode: true, pathTemplate: "/v1/messages" }),
    row({ provider: "polygon", documented: true, usedInCode: true, pathTemplate: "/v2/a" }),
    row({ provider: "polygon", documented: true, usedInCode: false, pathTemplate: "/v2/b" }),
  ];

  const { documentedTotal, usedInCode } = summarizeDocumentationCoverage(rows);

  assert.equal(documentedTotal, 2);
  assert.equal(usedInCode, 1, "the code-only anthropic row must not count toward used_in_code");
  assert.ok(usedInCode <= documentedTotal, "Coverage ratio must never exceed 100%");
});
