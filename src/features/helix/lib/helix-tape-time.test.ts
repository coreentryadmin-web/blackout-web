import { test } from "node:test";
import assert from "node:assert/strict";
import type { FlowAlert } from "@/lib/api";
import { tapeTimeDisplay, ESTIMATED_PREFIX } from "./helix-tape-time";

const flow = (over: Partial<FlowAlert>) => over as Pick<FlowAlert, "alerted_at" | "tape_time_estimated">;
const ISO = "2026-08-21T18:32:00.000Z"; // 14:32 ET

test("a real print time renders exactly, with the ET stamp in the tooltip", () => {
  const t = tapeTimeDisplay(flow({ alerted_at: ISO, tape_time_estimated: false }));
  assert.equal(t.estimated, false);
  assert.ok(!t.label.startsWith(ESTIMATED_PREFIX), "a real time must carry no estimate marker");
  assert.match(t.label, /08\/21\/2026 - 14:32/);
  assert.match(t.title, /ET$/);
});

test("an estimated time is marked VISIBLY, not only by styling and a tooltip", () => {
  // The whole point: the old convention was a dimmed italic plus a `title`, and a tooltip is
  // unreachable on touch. ~70% of the live tape carries an estimated time (§4A), so on a phone the
  // distinction was conveyed to nobody.
  const t = tapeTimeDisplay(flow({ alerted_at: ISO, tape_time_estimated: true }));
  assert.equal(t.estimated, true);
  assert.ok(t.label.startsWith(ESTIMATED_PREFIX), "the mark must be in the LABEL, not just the class");
  assert.match(t.title, /Ingest time/);
  assert.match(t.title, /08\/21\/2026 - 14:32/, "the exact stamp must still be available");
});

test("compact mode is for dense cards and loses no information", () => {
  const exact = tapeTimeDisplay(flow({ alerted_at: ISO, tape_time_estimated: false }));
  const compact = tapeTimeDisplay(flow({ alerted_at: ISO, tape_time_estimated: false }), { compact: true });
  assert.notEqual(compact.label, exact.label, "compact renders an age, not the full stamp");
  assert.equal(compact.title, exact.title, "the exact ET stamp still rides in the tooltip");
  // And the estimate marker survives compaction — it is the part that must never be dropped.
  const est = tapeTimeDisplay(flow({ alerted_at: ISO, tape_time_estimated: true }), { compact: true });
  assert.ok(est.label.startsWith(ESTIMATED_PREFIX));
});

test("no time at all is NOT an estimate — they are different facts", () => {
  // "we have no time" and "we have an ingest time" must not collapse: only the second is an
  // estimate OF anything, and marking the first as one would invent a measurement.
  for (const bad of [undefined, "", "not-a-date"]) {
    const t = tapeTimeDisplay(flow({ alerted_at: bad as string, tape_time_estimated: false }));
    assert.equal(t.label, "—", `${String(bad)} must render as absent`);
    assert.equal(t.estimated, false);
    assert.match(t.title, /No print time reported/);
  }
  // Even when the row CLAIMS to be estimated, an unusable timestamp is still just absent.
  const t = tapeTimeDisplay(flow({ alerted_at: "", tape_time_estimated: true }));
  assert.equal(t.label, "—");
  assert.equal(t.estimated, false);
});

test("both tape surfaces read this one statement", async () => {
  // The failure this closes is one field presented differently on two screens — six times over in
  // this lane. Asserted at the source level because rendering React here needs a DOM.
  const { readFileSync } = await import("node:fs");
  for (const f of [
    "src/features/helix/components/HelixFlowTable.tsx",
    "src/features/helix/components/HelixMobileFlowTape.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /tapeTimeDisplay\(/, `${f} must read the shared statement`);
  }
  // And the desktop table must no longer inline its own estimate rule.
  const desktop = readFileSync("src/features/helix/components/HelixFlowTable.tsx", "utf8");
  assert.doesNotMatch(
    desktop,
    /title=\{flow\.tape_time_estimated \?/,
    "the inlined tooltip rule is what drifted from mobile — it must be gone"
  );
});
