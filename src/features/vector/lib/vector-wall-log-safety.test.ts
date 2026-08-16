import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// SOURCE SCAN, not a behavioural test — the same shape as vector-wall-rail-rth-gate.test.ts's
// canonical-writer scan.
//
// WHY: two separate defects put untrusted data into these log calls, and only one of them is
// visible from behaviour.
//
//  1. Log injection — a ticker containing a newline forges a second log entry. Fixed by logToken().
//  2. Format-string injection — console.warn treats its FIRST argument as a format string, so a
//     ticker of "%s" consumes the `err` argument and the real error vanishes from the log. logToken
//     does NOT fix this (it neutralizes control characters, not format specifiers); the only robust
//     fix is to keep interpolation out of argument 0 entirely.
//
// Defect 2 is the dangerous one precisely because it degrades gracefully: the line still prints, it
// just quietly drops the error it existed to report. A unit test on logToken cannot see it — the bug
// is in the ARGUMENT POSITION, which is a property of the source. Hence this scan.

const FILES = [
  "src/features/vector/lib/vector-wall-db.ts",
  "src/features/vector/lib/vector-wall-persist.ts",
];

/**
 * Matches a console.* call whose FIRST argument is a template literal interpolating an
 * UNTRUSTED-CAPABLE value (a ticker, a storage id, a session, or anything already wrapped in
 * logToken — the wrapper marks the value as request-derived).
 *
 * Deliberately NOT a blanket ban on interpolation in argument 0: the sibling sites interpolate a row
 * COUNT (`${usable.length} rows`), and a number cannot carry a "%s". Banning those too would assert
 * a rule this codebase does not hold and flag provably safe code, which is how a guard test earns a
 * reputation for crying wolf and gets deleted.
 */
const UNTRUSTED = String.raw`(?:ticker|st|storageTicker|sessionYmd|logToken)`;
const INTERPOLATED_FORMAT_ARG = new RegExp(
  String.raw`console\.(?:log|info|warn|error|debug)\(\s*\`[^\`]*\$\{[^}]*` + UNTRUSTED
);

for (const file of FILES) {
  test(`${file}: no console.* call interpolates into its format-string argument`, () => {
    const src = readFileSync(file, "utf8");
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => INTERPOLATED_FORMAT_ARG.test(line));

    assert.deepEqual(
      offenders,
      [],
      `Untrusted-capable values must be passed as LATER arguments, never interpolated into ` +
        `argument 0 — Node parses that one as a format string, so a "%s" in a ticker swallows the ` +
        `error argument. Offending lines:\n` +
        offenders.map((o) => `  ${file}:${o.n}  ${o.line}`).join("\n")
    );
  });

  test(`${file}: every ticker/session logged goes through logToken()`, () => {
    const src = readFileSync(file, "utf8");
    // Any interpolation of the ticker/storage-id/session into a log line must be wrapped.
    const raw = src
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(
        ({ line }) =>
          /console\.(?:log|info|warn|error|debug)\(/.test(line) &&
          /\$\{\s*(?:ticker|st|storageTicker|sessionYmd)\s*\}/.test(line)
      );

    assert.deepEqual(
      raw,
      [],
      `Interpolate logToken(x), not x — a raw newline in a ticker forges a log entry. ` +
        `Offending lines:\n` + raw.map((o) => `  ${file}:${o.n}  ${o.line}`).join("\n")
    );
  });
}
