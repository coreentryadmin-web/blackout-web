import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isStagingPage,
  filterStagingRows,
  summarizeStaging,
  stagingVerdict,
} from "./staging-index-eval.mjs";

test("isStagingPage matches only the staging host", () => {
  assert.equal(isStagingPage("https://staging.blackouttrades.com/learn/glossary"), true);
  assert.equal(isStagingPage("https://staging.blackouttrades.com"), true);
  assert.equal(isStagingPage("https://blackouttrades.com/learn/glossary"), false);
  // must not false-positive on a lookalike host or a mention in a path/query
  assert.equal(isStagingPage("https://notstaging.blackouttrades.com/x"), false);
  assert.equal(isStagingPage("https://blackouttrades.com/x?ref=staging.blackouttrades.com"), false);
  assert.equal(isStagingPage(null), false);
});

test("filterStagingRows keeps only staging rows", () => {
  const rows = [
    { keys: ["https://staging.blackouttrades.com/nighthawk"], clicks: 0, impressions: 9, position: 3.7 },
    { keys: ["https://blackouttrades.com/nighthawk"], clicks: 5, impressions: 100, position: 2.0 },
    { keys: ["https://staging.blackouttrades.com/terminal"], clicks: 2, impressions: 8, position: 5.6 },
  ];
  const out = filterStagingRows(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(summarizeStaging(out), { urls: 2, clicks: 2, impressions: 17 });
});

test("stagingVerdict: served rows keep it OPEN", () => {
  assert.equal(stagingVerdict({ served: 8, hostResolves: true }).status, "OPEN");
});

test("stagingVerdict: 0 served but host still resolves is OPEN (5xx is temporary to Google)", () => {
  assert.equal(stagingVerdict({ served: 0, hostResolves: true }).status, "OPEN");
});

test("stagingVerdict: 0 served and host gone is CLOSEABLE", () => {
  assert.equal(stagingVerdict({ served: 0, hostResolves: false }).status, "CLOSEABLE");
});
