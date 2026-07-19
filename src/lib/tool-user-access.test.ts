import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildToolAccessRows,
  compactToolAccessMap,
  parseToolAccessMap,
  resolveToolAccessForUser,
} from "./tool-user-access";
import { isToolLaunched } from "./tool-access";

test("resolveToolAccessForUser respects grant/block/inherit", () => {
  assert.equal(resolveToolAccessForUser("largo", false, { largo: "grant" }), true);
  assert.equal(resolveToolAccessForUser("largo", true, { largo: "block" }), false);
  assert.equal(resolveToolAccessForUser("largo", true, {}), true);
  assert.equal(resolveToolAccessForUser("vector", false, {}), false);
});

test("parseToolAccessMap ignores unknown keys and bad values", () => {
  assert.deepEqual(parseToolAccessMap({ largo: "grant", bogus: "grant", vector: "nope" }), {
    largo: "grant",
  });
});

test("compactToolAccessMap drops inherit", () => {
  assert.deepEqual(
    compactToolAccessMap({ largo: "grant", vector: "inherit", spx: "block" }),
    { largo: "grant", spx: "block" }
  );
});

test("buildToolAccessRows combines global launch + overrides", () => {
  const env = { LAUNCHED_TOOLS: "largo" } as NodeJS.ProcessEnv;
  const rows = buildToolAccessRows((k) => isToolLaunched(k, env), { vector: "grant" });
  const largo = rows.find((r) => r.key === "largo");
  const vector = rows.find((r) => r.key === "vector");
  assert.equal(largo?.globalLaunched, true);
  assert.equal(largo?.effective, true);
  assert.equal(vector?.globalLaunched, false);
  assert.equal(vector?.effective, true);
});
