import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePlaybookLiveAllowlist,
} from "./spx-play-config";

test("parsePlaybookLiveAllowlist: prod unset returns null (no filter)", () => {
  assert.equal(parsePlaybookLiveAllowlist(undefined, false), null);
});

test("parsePlaybookLiveAllowlist: explicit list on prod", () => {
  const allowlist = parsePlaybookLiveAllowlist("PB-04,PB-08", false);
  assert.ok(allowlist);
  assert.deepEqual([...allowlist], ["PB-04", "PB-08"]);
});

test("parsePlaybookLiveAllowlist: * disables filter", () => {
  assert.equal(parsePlaybookLiveAllowlist("*", false), null);
  assert.equal(parsePlaybookLiveAllowlist("all", false), null);
});
