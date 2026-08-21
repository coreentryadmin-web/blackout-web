import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import {
  attachmentCaptureBlockReason,
  cycleKeyForEt,
  isCapturableSourceUrl,
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

describe("isCapturableSourceUrl", () => {
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
      const v = isCapturableSourceUrl(`https://blackouttrades.com${path}`);
      assert.equal(v.ok, false);
    });
  }

  for (const path of ["/vector?ticker=SPX", "/flows", "/heatmap", "/nighthawk", "/terminal"]) {
    it(`allows ${path}`, () => {
      assert.equal(isCapturableSourceUrl(`https://blackouttrades.com${path}`).ok, true);
    });
  }

  it("refuses a debug-flagged query on an otherwise public route", () => {
    const v = isCapturableSourceUrl("https://blackouttrades.com/vector?ticker=SPX&debug=1");
    assert.equal(v.ok, false);
  });

  it("refuses an unparseable URL rather than letting it through", () => {
    assert.equal(isCapturableSourceUrl("/admin").ok, false);
    assert.equal(isCapturableSourceUrl("").ok, false);
  });

  it("refuses non-https", () => {
    assert.equal(isCapturableSourceUrl("http://blackouttrades.com/vector").ok, false);
  });

  it("is not fooled by an admin path appearing later in the URL", () => {
    // The deny-list anchors at the start of the pathname, so a legitimate desk route that merely
    // contains the word must still be capturable — otherwise the check drifts into refusing real work.
    assert.equal(isCapturableSourceUrl("https://blackouttrades.com/vector?ref=/admin").ok, true);
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
