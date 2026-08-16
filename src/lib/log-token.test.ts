import test from "node:test";
import assert from "node:assert/strict";
import { logToken } from "./log-token.ts";

// Control characters are built with String.fromCharCode so this test file contains no literal
// control bytes of its own — the same reason log-token.ts builds its character class from a string.
const NUL = String.fromCharCode(0);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);
const REPL = "�";

test("logToken passes a normal ticker through untouched", () => {
  assert.equal(logToken("SPY"), "SPY");
  assert.equal(logToken("BRK.B"), "BRK.B");
  assert.equal(logToken("SPY::0dte"), "SPY::0dte", "storage ids keep their ::horizon suffix");
});

test("logToken neutralizes the forged-log-line attack", () => {
  // THE bug this exists for: a newline in the ticker splits one log entry into two, and the second
  // is indistinguishable from a genuine line written by this same module.
  const forged = `AAPL${LF}[vector-wall-db] persist failed SPY:2026-08-16:`;
  const out = logToken(forged);
  assert.ok(!out.includes(LF), "no newline may survive");
  assert.equal(out.split(LF).length, 1, "must render as exactly one line");
  assert.ok(out.startsWith(`AAPL${REPL}`));
});

test("logToken replaces CR, TAB, NUL, ESC and DEL", () => {
  for (const ch of [CR, TAB, NUL, ESC, DEL]) {
    const out = logToken(`SP${ch}Y`);
    assert.equal(out, `SP${REPL}Y`, `char code ${ch.charCodeAt(0)} must be replaced`);
  }
});

test("logToken defeats an ANSI escape sequence", () => {
  // A raw ESC lets a hostile value repaint an operator's terminal, not just add a line.
  const out = logToken(`${ESC}[2JSPY`);
  assert.ok(!out.includes(ESC));
  assert.equal(out, `${REPL}[2JSPY`);
});

test("logToken REPLACES rather than strips, so fields cannot silently weld together", () => {
  // Stripping would turn this into "SPYQQQ" — a plausible-looking token that never existed.
  assert.equal(logToken(`SPY${LF}QQQ`), `SPY${REPL}QQQ`);
});

test("logToken caps length so one value cannot flood the log", () => {
  const out = logToken("A".repeat(5000));
  assert.ok(out.length <= 65, `expected <= 65 chars, got ${out.length}`);
  assert.ok(out.endsWith("…"), "truncation must be visible");
});

test("logToken renders absent values explicitly, never as a blank gap", () => {
  // "failed :2026-08-16:" reads as a formatting bug; "failed <empty>:2026-08-16:" reads as data.
  assert.equal(logToken(null), "<empty>");
  assert.equal(logToken(undefined), "<empty>");
  assert.equal(logToken(""), "<empty>");
});

test("logToken coerces non-strings to a bounded token", () => {
  assert.equal(logToken(42), "42");
  assert.equal(logToken(0), "0", "zero is a value, not an absence");
  assert.equal(logToken(false), "false");
});

test("logToken is stateless across calls (no lastIndex leak from the global regex)", () => {
  // A /g regex reused via .test() would carry lastIndex between calls; .replace() resets it, and
  // this pins that — a stateful sanitizer would let one call's input change the next call's output.
  const dirty = `SPY${LF}X`;
  assert.equal(logToken(dirty), logToken(dirty));
  assert.equal(logToken(dirty), `SPY${REPL}X`);
});
