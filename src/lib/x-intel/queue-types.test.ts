import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import {
  attachmentCaptureBlockReason,
  cycleKeyForEt,
  checkCaptureUrl,
  readyBlockReason,
  type XIntelAttachment,
  type XIntelChronology,
  type XIntelQueueRow,
} from "@/lib/x-intel/queue-types";
import { X_INTEL_QUEUE_FIXTURES } from "@/lib/x-intel/queue-fixtures";

function attachment(over: Partial<XIntelAttachment> = {}): XIntelAttachment {
  return {
    slot: 1,
    role: "PRICE",
    image_url: "/x-intel/a.png",
    caption: "c",
    source_surface: "vector",
    source_url: "https://blackouttrades.com/vector?ticker=SPX",
    captured_at_et: "2026-08-21 11:48 ET",
    ...over,
  };
}

type ReadyInput = Parameters<typeof readyBlockReason>[0];

function readyRow(over: Partial<ReadyInput> = {}): ReadyInput {
  return {
    status: "READY",
    post_copy: "SPX lost the flip.",
    attachments: [
      attachment({ slot: 1, source_surface: "vector" }),
      attachment({
        slot: 2,
        source_surface: "thermal",
        source_url: "https://blackouttrades.com/heatmap",
      }),
    ],
    chronology: null,
    underlying_evidence: [{ what: "flip", value: "6784", source: "thermal" }],
    ...over,
  };
}

function chronology(over: Partial<XIntelChronology> = {}): XIntelChronology {
  return {
    precedence_claimed: true,
    detection: {
      at_et: "2026-08-21 11:34 ET",
      at_ms: Date.UTC(2026, 7, 21, 15, 34),
      what: "detected",
      surface: "thermal",
    },
    market_event: {
      at_et: "2026-08-21 11:42 ET",
      at_ms: Date.UTC(2026, 7, 21, 15, 42),
      what: "moved",
      surface: "market",
    },
    marks: [],
    ...over,
  };
}

describe("readyBlockReason — chronology", () => {
  it("allows a precedence claim when detection strictly precedes the move", () => {
    assert.equal(readyBlockReason(readyRow({ chronology: chronology() })), null);
  });

  it("refuses a precedence claim when detection FOLLOWS the move", () => {
    const backfilled = chronology({
      detection: {
        at_et: "2026-08-21 11:50 ET",
        at_ms: Date.UTC(2026, 7, 21, 15, 50),
        what: "detected",
        surface: "thermal",
      },
    });
    const reason = readyBlockReason(readyRow({ chronology: backfilled }));
    assert.match(String(reason), /not strictly earlier/);
  });

  it("refuses a precedence claim on SIMULTANEOUS timestamps — equal is not earlier", () => {
    const sameMs = Date.UTC(2026, 7, 21, 15, 42);
    const tie = chronology({
      detection: { at_et: "2026-08-21 11:42 ET", at_ms: sameMs, what: "d", surface: "thermal" },
      market_event: { at_et: "2026-08-21 11:42 ET", at_ms: sameMs, what: "m", surface: "market" },
    });
    assert.match(String(readyBlockReason(readyRow({ chronology: tie }))), /not strictly earlier/);
  });

  it("refuses a precedence claim with a missing timestamp rather than assuming it", () => {
    const halfEvidenced = chronology({ market_event: null });
    assert.match(String(readyBlockReason(readyRow({ chronology: halfEvidenced }))), /BOTH/);
  });

  it("allows a package that claims no precedence and carries no timestamps", () => {
    const reported = chronology({
      precedence_claimed: false,
      detection: null,
      market_event: null,
    });
    assert.equal(readyBlockReason(readyRow({ chronology: reported })), null);
  });
});

describe("readyBlockReason — evidence floor", () => {
  it("refuses READY with a single attachment", () => {
    const reason = readyBlockReason(readyRow({ attachments: [attachment()] }));
    assert.match(String(reason), /at least 2 attachments/);
  });

  it("refuses two attachments from the SAME surface — that is not corroboration", () => {
    const sameSurface = readyRow({
      attachments: [
        attachment({ slot: 1, source_surface: "helix" }),
        attachment({ slot: 2, source_surface: "helix" }),
      ],
    });
    assert.match(String(readyBlockReason(sameSurface)), /2 DIFFERENT surfaces/);
  });

  it("refuses READY with no underlying evidence", () => {
    assert.match(
      String(readyBlockReason(readyRow({ underlying_evidence: [] }))),
      /underlying_evidence/,
    );
  });

  it("refuses READY with empty post copy", () => {
    assert.match(String(readyBlockReason(readyRow({ post_copy: "   " }))), /post_copy/);
  });

  it("does not gate SKIP rows — an empty package is the correct shape for a quiet hour", () => {
    const skip = readyRow({
      status: "SKIP",
      post_copy: null,
      attachments: [],
      underlying_evidence: [],
    });
    assert.equal(readyBlockReason(skip), null);
  });
});

describe("checkCaptureUrl (delegated to capture-guard.ts)", () => {
  for (const path of [
    "/admin",
    "/admin/users",
    "/api/admin/analytics/x",
    "/api/cron/x-autopost",
    "/api/debug/state",
    "/sign-in",
    "/account/billing",
    "/settings",
  ]) {
    it(`refuses ${path}`, () => {
      const v = checkCaptureUrl(`https://blackouttrades.com${path}`);
      assert.equal(v.ok, false);
    });
  }

  for (const path of ["/vector?ticker=SPX", "/flows", "/heatmap", "/nighthawk", "/terminal"]) {
    it(`allows ${path}`, () => {
      assert.equal(checkCaptureUrl(`https://blackouttrades.com${path}`).ok, true);
    });
  }

  it("refuses a debug-flagged query on an otherwise public route", () => {
    const v = checkCaptureUrl("https://blackouttrades.com/vector?ticker=SPX&debug=1");
    assert.equal(v.ok, false);
  });

  it("refuses an unparseable URL rather than letting it through", () => {
    assert.equal(checkCaptureUrl("/admin").ok, false);
    assert.equal(checkCaptureUrl("").ok, false);
  });

  it("refuses non-https", () => {
    assert.equal(checkCaptureUrl("http://blackouttrades.com/vector").ok, false);
  });

  it("is not fooled by an admin path appearing later in the URL", () => {
    // The deny-list anchors at the start of the pathname, so a legitimate desk route that merely
    // contains the word must still be capturable — otherwise the check drifts into refusing real work.
    assert.equal(checkCaptureUrl("https://blackouttrades.com/vector?ref=/admin").ok, true);
  });

  it("now ALSO fails closed on a route that is on neither list", () => {
    // The strengthening this delegation bought: the old local copy was denylist-only and would
    // have ALLOWED an unknown route. The canonical guard refuses it.
    assert.equal(checkCaptureUrl("https://blackouttrades.com/some-new-internal-page").ok, false);
  });
});

describe("attachmentCaptureBlockReason", () => {
  it("names the offending slot", () => {
    const reason = attachmentCaptureBlockReason([
      attachment({ slot: 1 }),
      attachment({ slot: 2, source_url: "https://blackouttrades.com/admin/users" }),
    ]);
    assert.match(String(reason), /attachment 2/);
    assert.match(String(reason), /admin console/);
  });

  it("passes a clean set", () => {
    assert.equal(attachmentCaptureBlockReason([attachment()]), null);
  });
});

describe("fixtures", () => {
  const byStatus = (s: XIntelQueueRow["status"]) =>
    X_INTEL_QUEUE_FIXTURES.filter((r) => r.status === s);

  it("cover READY, REVIEW and SKIP", () => {
    assert.ok(byStatus("READY").length >= 2);
    assert.equal(byStatus("REVIEW").length, 1);
    assert.equal(byStatus("SKIP").length, 1);
  });

  it("every READY fixture survives its own gate", () => {
    for (const row of byStatus("READY")) {
      assert.equal(readyBlockReason(row), null, `fixture ${row.cycle_key} should be publishable`);
    }
  });

  it("every fixture attachment comes from a capturable URL", () => {
    for (const row of X_INTEL_QUEUE_FIXTURES) {
      assert.equal(attachmentCaptureBlockReason(row.attachments), null, row.cycle_key);
    }
  });

  it("every attachment from a BLACKOUT surface carries a view signature for visual memory", () => {
    for (const row of X_INTEL_QUEUE_FIXTURES) {
      for (const a of row.attachments) {
        assert.ok(a.view, `${row.cycle_key} slot ${a.slot} has no view signature`);
      }
    }
  });

  it("no package repeats the same view twice within itself", () => {
    // Three near-identical screenshots is a failed package, not a package with a weak third slot.
    for (const row of X_INTEL_QUEUE_FIXTURES) {
      const ids = row.attachments.map((a) => a.view?.view_id).filter(Boolean);
      assert.equal(new Set(ids).size, ids.length, `${row.cycle_key} repeats a view`);
    }
  });

  it("omits `confidence` entirely where it is not calibrated — never null, never a default", () => {
    const nvda = X_INTEL_QUEUE_FIXTURES.find((r) => r.ticker_or_market === "NVDA");
    assert.ok(nvda);
    assert.equal("confidence" in nvda, false);
  });

  it("carries a calibrated confidence WITH its sample size where it is claimed", () => {
    const spx = X_INTEL_QUEUE_FIXTURES.find((r) => r.cycle_key === "2026-08-21T11");
    assert.ok(spx?.confidence);
    assert.ok(spx.confidence.sample_size != null, "a rate without its denominator is not a fact");
    assert.ok(spx.confidence.basis.trim().length > 0);
  });

  it("the SKIP row still records what it looked at and why it declined", () => {
    const skip = byStatus("SKIP")[0]!;
    assert.equal(skip.post_copy, null);
    assert.ok(skip.products_referenced.length >= 4);
    assert.ok(skip.underlying_evidence.length > 0, "absence is a finding, not a blank");
    assert.ok(skip.reason_selected.length > 40);
  });

  it("has unique cycle keys — one package per cycle", () => {
    const keys = X_INTEL_QUEUE_FIXTURES.map((r) => r.cycle_key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("cycleKeyForEt — the slot is the ET hour, not the UTC one", () => {
  // The real helpers, so the test exercises the same ET conversion production uses.
  const deps = { etStamp, etSessionDate };

  it("derives the ET hour under EDT", () => {
    // 2026-08-21 15:30 UTC === 11:30 ET (UTC-4)
    assert.equal(cycleKeyForEt(Date.UTC(2026, 7, 21, 15, 30), deps), "2026-08-21T11");
  });

  it("derives the ET hour under EST — the DST case that silently breaks x-autopost", () => {
    // 2026-11-16 15:30 UTC === 10:30 ET (UTC-5). A pipeline that read the UTC hour would file
    // this under 15 and drift a full hour against the session for four months of the year.
    assert.equal(cycleKeyForEt(Date.UTC(2026, 10, 16, 15, 30), deps), "2026-11-16T10");
  });

  it("rolls the session date back for a late-UTC instant that is still the prior ET day", () => {
    // 2026-08-22 01:00 UTC === 2026-08-21 21:00 ET. The session date must follow the ET calendar,
    // not the UTC one — contract C1.
    assert.equal(cycleKeyForEt(Date.UTC(2026, 7, 22, 1, 0), deps), "2026-08-21T21");
  });

  it("returns null for a non-instant rather than defaulting to now", () => {
    assert.equal(cycleKeyForEt(Number.NaN, deps), null);
  });

  it("produces the same key for two instants in the same ET hour, and different across hours", () => {
    const a = cycleKeyForEt(Date.UTC(2026, 7, 21, 15, 30), deps);
    const b = cycleKeyForEt(Date.UTC(2026, 7, 21, 15, 59), deps);
    const c = cycleKeyForEt(Date.UTC(2026, 7, 21, 16, 0), deps);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe("blind spots — an unread surface must never arrive as a read one", () => {
  const blind = (surface: string) => ({
    surface: surface as never,
    what_is_missing: "the flow tape never populated",
    reason: "upstream timeout",
    retryable: true,
  });

  it("refuses READY when the package references a surface it could not read", () => {
    const reason = readyBlockReason({
      ...readyRow(),
      products_referenced: ["helix", "thermal"] as never,
      blind_spots: [blind("helix")],
    });
    assert.match(String(reason), /references helix but that surface could not be read/);
  });

  it("allows READY when the blind surface is NOT one the package claims", () => {
    // Being blind to Meridian does not invalidate a Thermal + Vector gamma story.
    assert.equal(
      readyBlockReason({
        ...readyRow(),
        products_referenced: ["thermal", "vector"] as never,
        blind_spots: [blind("meridian")],
      }),
      null,
    );
  });

  it("refuses a QUIET skip while any surface was blind — that is BLIND, not QUIET", () => {
    // "The market was quiet" is only sayable about surfaces that were actually read. Reporting our
    // own outage as a fact about the tape is how a week of dead harness reads as a dull market.
    const reason = readyBlockReason({
      ...readyRow({ status: "SKIP", post_copy: null, attachments: [], underlying_evidence: [] }),
      skip_kind: "QUIET",
      blind_spots: [blind("helix")],
    });
    assert.match(String(reason), /that is BLIND, not QUIET/);
  });

  it("allows a QUIET skip when nothing was blind", () => {
    assert.equal(
      readyBlockReason({
        ...readyRow({ status: "SKIP", post_copy: null, attachments: [], underlying_evidence: [] }),
        skip_kind: "QUIET",
        blind_spots: [],
      }),
      null,
    );
  });

  it("refuses a BLIND skip that does not name what could not be read", () => {
    const reason = readyBlockReason({
      ...readyRow({ status: "SKIP", post_copy: null, attachments: [], underlying_evidence: [] }),
      skip_kind: "BLIND",
      blind_spots: [],
    });
    assert.match(String(reason), /name what could not be read/);
  });

  it("a package with no blind_spots field behaves exactly as before", () => {
    // Absent must mean "nothing was blind", not "unknown" — the writers all populate it.
    assert.equal(readyBlockReason(readyRow()), null);
  });

  it("the SKIP fixture declares QUIET, not a bare skip", () => {
    const skip = X_INTEL_QUEUE_FIXTURES.find((r) => r.status === "SKIP")!;
    assert.equal(skip.skip_kind, "QUIET");
    assert.deepEqual(skip.blind_spots, []);
  });
});
