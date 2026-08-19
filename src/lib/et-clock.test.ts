import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { etClock, etDateTimeShort } from "./et-clock";

/**
 * A markets desk quotes ONE clock: US/Eastern.
 *
 * Eleven member-facing formatters had drifted off it by omitting `timeZone`, which silently renders
 * in the viewer's zone. The failure is invisible to anyone in Eastern, which is why it survived: the
 * code looks right, the tests passed, and the screenshots were correct for whoever took them.
 *
 * What a member outside Eastern actually saw at 2:30:05 PM ET (measured, not hypothesised):
 *
 *   surface                          Los Angeles     London          correct (ET)
 *   SpxPulseRail clock               11:30:05        19:30:05        14:30:05
 *   SpxPulseRail / Largo event time  11:30 AM        7:30 PM         2:30 PM
 *   MeridianHero "As of … ET"        11:30 AM        07:30 PM        02:30 PM
 *   PlayTerminalWindow               11:30:05 AM     7:30:05 PM      2:30:05 PM
 *   Helix contract drawer            11:30           19:30           14:30
 *   BangerBoard timestamp            19 Aug, 19:30 (en-GB locale too)  Aug 19, 2:30 PM
 *
 * MeridianHero is the sharpest case: it renders a literal " ET" immediately after the time, so the
 * line asserted a timezone it was not rendering in. And /dashboard puts the Pulse and Largo rails
 * directly beside the GEX matrix "as of", which IS pinned to Eastern — two clocks on one screen,
 * three hours apart on the US West Coast.
 */

// 2026-08-19T18:30:05Z = 2:30:05 PM EDT (UTC-4)
const EDT = Date.parse("2026-08-19T18:30:05Z");
// 2026-01-14T19:30:05Z = 2:30:05 PM EST (UTC-5) — same wall clock, different offset.
const EST = Date.parse("2026-01-14T19:30:05Z");

test("etClock renders Eastern wall-clock time in every shape the product uses", () => {
  assert.equal(etClock(EDT), "2:30 PM");
  assert.equal(etClock(EDT, { seconds: true }), "2:30:05 PM");
  assert.equal(etClock(EDT, { pad: true }), "02:30 PM");
  assert.equal(etClock(EDT, { hour12: false }), "14:30");
  assert.equal(etClock(EDT, { pad: true, hour12: false }), "14:30");
  assert.equal(etClock(EDT, { pad: true, seconds: true, hour12: false }), "14:30:05");
});

test("the zone is the PRODUCT's, not the process's — a UTC server and an ET browser agree", () => {
  // The whole class of bug is a formatter that inherits an ambient zone. This asserts the output is
  // a function of the instant alone: 18:30:05Z is 2:30 PM ET no matter where this test runs.
  assert.equal(etClock(EDT), "2:30 PM");
  assert.equal(etClock("2026-08-19T18:30:05Z"), "2:30 PM");
  assert.equal(etClock(new Date(EDT)), "2:30 PM");
});

test("DST is handled by the zone, not by an offset constant", () => {
  // Same 2:30 PM wall clock either side of the DST boundary, five hours apart in UTC. A hardcoded
  // -4 or -5 would get one of these wrong; a named zone gets both right.
  assert.equal(etClock(EDT), "2:30 PM");
  assert.equal(etClock(EST), "2:30 PM");
});

test("PARITY: the already-correct surfaces render byte-identically after migration", () => {
  // SpxSessionTimeBar, SpxGexMatrixHeatmap and VectorOdteMatrixRail already pinned Eastern with
  // their own inline options. They were migrated to this helper so ONE implementation exists — but
  // only because the output is unchanged. If that ever stops being true, this fails rather than
  // quietly restyling three live surfaces.
  const ET = "America/New_York";
  assert.equal(
    etClock(EDT),
    new Date(EDT).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }),
    "SpxSessionTimeBar.fmtDotTime"
  );
  const withSeconds = new Date(EDT).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: ET,
  });
  assert.equal(etClock(EDT, { seconds: true }), withSeconds, "matrix / vector rail as-of");
});

test("a missing or unparseable instant yields null, never a fabricated or Invalid time", () => {
  for (const bad of [null, undefined, "", "not-a-date", Number.NaN, Infinity]) {
    assert.equal(etClock(bad as never), null, String(bad));
    assert.equal(etDateTimeShort(bad as never), null, String(bad));
  }
  // Specifically NOT the string "Invalid Date", which `new Date(x).toLocaleTimeString()` produces
  // and which reads on screen as a broken product rather than as absent data.
  assert.notEqual(etClock("not-a-date"), "Invalid Date");
});

test("etDateTimeShort pins the LOCALE as well as the zone", () => {
  // BangerBoard passed `undefined` as its locale, so the viewer's locale chose the field order and
  // the hour cycle: "19 Aug, 19:30" in London vs "Aug 19, 2:30 PM" in New York, same instant.
  assert.equal(etDateTimeShort(EDT), "Aug 19, 2:30 PM");
  assert.equal(etDateTimeShort(EDT, { seconds: true }), "Aug 19, 2:30:05 PM");
  assert.equal(etDateTimeShort(EST), "Jan 14, 2:30 PM");
});

test("repeated calls reuse one formatter and stay stable", () => {
  // The replaced code built a fresh Intl.DateTimeFormat per row per render inside list maps.
  const first = etClock(EDT, { seconds: true });
  for (let i = 0; i < 500; i++) assert.equal(etClock(EDT, { seconds: true }), first);
});

// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");
const SELF = join("lib", "et-clock");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("no surface formats a wall-clock time without pinning the timezone", () => {
  // The guard that makes this class of bug non-recurring. Every one of the eleven sites looked
  // locally reasonable; what was missing was anything that could see them all at once.
  //
  // Only TIME formatting is checked — `toLocaleString` is also the idiomatic number formatter here
  // (`n.toLocaleString("en-US", { maximumFractionDigits: 2 })`), and flagging those would make this
  // test noise, which is how a guard gets deleted.
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    if (file.includes(SELF)) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes("toLocale")) continue;

    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("toLocaleTimeString(") && !line.includes("toLocaleString(")) return;

      // Read forward only to the END OF THIS CALL, by balancing parentheses from the call site.
      // A fixed lookahead window is what made the first run of this test cry wolf: it reached past
      // a number formatter in spx-live-voice.ts into an unrelated `hour:` several lines below and
      // reported it as a rogue clock.
      const start = Math.max(line.indexOf("toLocaleTimeString("), line.indexOf("toLocaleString("));
      let depth = 0;
      let call = "";
      outer: for (let j = i; j < Math.min(lines.length, i + 12); j++) {
        const from = j === i ? start : 0;
        for (let k = from; k < lines[j]!.length; k++) {
          const ch = lines[j]![k]!;
          call += ch;
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth === 0) break outer;
          }
        }
        call += "\n";
      }

      // A TIME formatter is toLocaleTimeString, or toLocaleString carrying an `hour` field.
      // toLocaleString with only fraction-digit options is the repo's number formatter — not ours.
      const isTimeCall = call.includes("toLocaleTimeString(") || /\bhour\s*:/.test(call);
      if (!isTimeCall) return;
      if (call.includes("timeZone")) return;
      offenders.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "These render a time in the VIEWER's timezone, not the market's. On a desk where every other " +
      "clock is Eastern that is a wrong number, not a preference — use etClock/etDateTimeShort " +
      "from @/lib/et-clock:\n  " +
      offenders.join("\n  ")
  );
});
