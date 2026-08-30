import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateCaptureSource,
  validateCaptureFreshness,
  formatTimeEt,
  attachmentsFromCaptures,
  validateAttachmentConstraints,
  type CaptureResult,
} from "./capture-harness";

describe("capture-harness validators", () => {
  describe("validateCaptureSource", () => {
    it("allows public surfaces on admin capture", () => {
      const err = validateCaptureSource("vector", true);
      assert.equal(err, null);
    });

    it("blocks member-data surfaces on admin capture", () => {
      const err = validateCaptureSource("helix", true);
      assert.match(err || "", /admin\/member data/);
    });

    it("blocks thermal on admin capture", () => {
      const err = validateCaptureSource("thermal", true);
      assert.match(err || "", /admin\/member data/);
    });

    it("blocks nighthawk on admin capture", () => {
      const err = validateCaptureSource("nighthawk", true);
      assert.match(err || "", /admin\/member data/);
    });

    it("allows all surfaces on non-admin capture", () => {
      const sources = ["helix", "thermal", "vector", "spx_slayer", "nighthawk", "meridian", "largo"] as const;
      sources.forEach((s) => {
        const err = validateCaptureSource(s, false);
        assert.equal(err, null);
      });
    });
  });

  describe("validateCaptureFreshness", () => {
    it("passes when screenshot is fresh", () => {
      const now = Date.now();
      const captured = now - 30 * 60 * 1000; // 30 min ago
      const err = validateCaptureFreshness(captured, now);
      assert.equal(err, null);
    });

    it("passes at the 90-minute boundary", () => {
      const now = Date.now();
      const captured = now - 90 * 60 * 1000; // exactly 90 min
      const err = validateCaptureFreshness(captured, now);
      assert.equal(err, null);
    });

    it("fails when screenshot is stale (>90 min)", () => {
      const now = Date.now();
      const captured = now - 95 * 60 * 1000; // 95 min ago
      const err = validateCaptureFreshness(captured, now);
      assert.match(err || "", /stale|old/i);
    });

    it("fails when screenshot is 2+ hours old", () => {
      const now = Date.now();
      const captured = now - 120 * 60 * 1000; // 2 hours ago
      const err = validateCaptureFreshness(captured, now);
      assert.match(err || "", /stale|old/i);
    });

    it("respects custom max age", () => {
      const now = Date.now();
      const captured = now - 40 * 60 * 1000; // 40 min ago
      const maxAge = 30 * 60 * 1000; // 30 min max
      const err = validateCaptureFreshness(captured, now, maxAge);
      assert.match(err || "", /old/);
    });
  });

  describe("formatTimeEt", () => {
    it("formats timestamp in ET timezone", () => {
      // Use a known timestamp: 2026-08-23 14:30:00 UTC
      const utcTime = new Date("2026-08-23T14:30:00Z").getTime();
      const formatted = formatTimeEt(utcTime);

      // UTC 14:30 = ET 10:30 (EDT, UTC-4)
      assert.match(formatted, /08-23/);
      assert.match(formatted, /10:30/);
      assert.match(formatted, /ET/);
    });

    it("preserves date accuracy", () => {
      const ts = new Date("2026-08-15T18:45:30Z").getTime();
      const formatted = formatTimeEt(ts);
      assert.match(formatted, /08-15/);
    });
  });

  describe("attachmentsFromCaptures", () => {
    it("returns empty array when no captures", () => {
      const result = attachmentsFromCaptures([]);
      assert.equal(result.length, 0);
    });

    it("filters out failed captures", () => {
      const now = Date.now();
      const captures: CaptureResult[] = [
        {
          source: "helix",
          success: true,
          imageUrl: "/helix.png",
          caption: "Helix",
          capturedAtMs: now,
          capturedAtEt: formatTimeEt(now),
        },
        {
          source: "thermal",
          success: false,
          error: "timeout",
        },
      ];
      const result = attachmentsFromCaptures(captures, now);
      assert.equal(result.length, 1);
      assert.equal(result[0].source_surface, "helix");
    });

    it("filters out stale captures", () => {
      const now = Date.now();
      const staleTime = formatTimeEt(now - 120 * 60 * 1000); // 2 hours old

      const captures: CaptureResult[] = [
        {
          source: "helix",
          success: true,
          imageUrl: "/helix.png",
          caption: "Helix",
          capturedAtEt: staleTime,
        },
      ];
      const result = attachmentsFromCaptures(captures, now);
      assert.equal(result.length, 0);
    });

    it("returns max 3 attachments", () => {
      const now = Date.now();
      const freshMs = now - 30 * 60 * 1000;
      const freshTime = formatTimeEt(freshMs);

      const captures: CaptureResult[] = [
        { source: "helix", success: true, imageUrl: "/h.png", caption: "H", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "thermal", success: true, imageUrl: "/t.png", caption: "T", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "vector", success: true, imageUrl: "/v.png", caption: "V", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "spx_slayer", success: true, imageUrl: "/s.png", caption: "S", capturedAtMs: freshMs, capturedAtEt: freshTime },
      ];
      const result = attachmentsFromCaptures(captures, now);
      assert.equal(result.length, 3);
    });

    it("prefers one capture per distinct source over duplicating a surface (requireDiversity default)", () => {
      // Regression: requireDiversity used to be a no-op -- fresh.slice(0, Math.min(fresh.length,
      // maxAttachments)) and fresh.slice(0, maxAttachments) are byte-identical for every input,
      // since Array.prototype.slice already clamps its end index. Neither branch ever looked at
      // source. [helix, helix, thermal, vector] with maxAttachments=3 used to ship
      // [helix, helix, thermal] -- vector silently dropped, helix duplicated.
      const now = Date.now();
      const freshMs = now - 30 * 60 * 1000;
      const freshTime = formatTimeEt(freshMs);
      const captures: CaptureResult[] = [
        { source: "helix", success: true, imageUrl: "/h1.png", caption: "H1", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "helix", success: true, imageUrl: "/h2.png", caption: "H2", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "thermal", success: true, imageUrl: "/t.png", caption: "T", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "vector", success: true, imageUrl: "/v.png", caption: "V", capturedAtMs: freshMs, capturedAtEt: freshTime },
      ];
      const result = attachmentsFromCaptures(captures, now, { maxAttachments: 3 });
      const sources = result.map((a) => a.source_surface);
      assert.equal(new Set(sources).size, 3, `expected 3 distinct surfaces, got: ${sources.join(", ")}`);
      assert.deepEqual(sources.sort(), ["helix", "thermal", "vector"]);
    });

    it("falls back to duplicate-source captures only once distinct sources are exhausted", () => {
      const now = Date.now();
      const freshMs = now - 30 * 60 * 1000;
      const freshTime = formatTimeEt(freshMs);
      const captures: CaptureResult[] = [
        { source: "helix", success: true, imageUrl: "/h1.png", caption: "H1", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "helix", success: true, imageUrl: "/h2.png", caption: "H2", capturedAtMs: freshMs, capturedAtEt: freshTime },
      ];
      const result = attachmentsFromCaptures(captures, now, { maxAttachments: 3 });
      assert.equal(result.length, 2, "only 2 captures existed at all -- can't invent a third");
    });

    it("assigns slot numbers 1, 2, 3", () => {
      const now = Date.now();
      const freshMs = now - 30 * 60 * 1000;
      const freshTime = formatTimeEt(freshMs);

      const captures: CaptureResult[] = [
        { source: "helix", success: true, imageUrl: "/h.png", caption: "H", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "thermal", success: true, imageUrl: "/t.png", caption: "T", capturedAtMs: freshMs, capturedAtEt: freshTime },
      ];
      const result = attachmentsFromCaptures(captures, now);
      assert.equal(result[0].slot, 1);
      assert.equal(result[1].slot, 2);
    });

    it("assigns roles by position", () => {
      const now = Date.now();
      const freshMs = now - 30 * 60 * 1000;
      const freshTime = formatTimeEt(freshMs);

      const captures: CaptureResult[] = [
        { source: "helix", success: true, imageUrl: "/h.png", caption: "H", capturedAtMs: freshMs, capturedAtEt: freshTime },
        { source: "thermal", success: true, imageUrl: "/t.png", caption: "T", capturedAtMs: freshMs, capturedAtEt: freshTime },
      ];
      const result = attachmentsFromCaptures(captures, now);
      assert.equal(result[0].role, "PRICE");
      assert.equal(result[1].role, "BLACKOUT_SIGNAL");
    });
  });

  describe("validateAttachmentConstraints", () => {
    it("fails with no attachments", () => {
      const err = validateAttachmentConstraints([]);
      assert.match(err || "", /no attachments/);
    });

    it("fails with >3 attachments", () => {
      const attachments = Array.from({ length: 4 }, (_, i) => ({
        slot: ((i + 1) % 3 || 3) as 1 | 2 | 3,
        role: "SUPPORT" as const,
        image_url: `/img${i}.png`,
        caption: `Cap${i}`,
        source_surface: ["helix", "thermal", "vector", "spx_slayer"][i] as any,
        source_url: "",
        captured_at_et: "",
        view: null,
      }));
      const err = validateAttachmentConstraints(attachments);
      assert.match(err || "", /too many/);
    });

    it("passes with diverse sources", () => {
      const attachments = [
        {
          slot: 1 as const,
          role: "LEAD" as const,
          image_url: "/helix.png",
          caption: "Helix",
          source_surface: "helix" as const,
          source_url: "",
          captured_at_et: "",
          view: null,
        },
        {
          slot: 2 as const,
          role: "SUPPORT" as const,
          image_url: "/thermal.png",
          caption: "Thermal",
          source_surface: "thermal" as const,
          source_url: "",
          captured_at_et: "",
          view: null,
        },
      ];
      const err = validateAttachmentConstraints(attachments);
      assert.equal(err, null);
    });

    it("warns when 2+ attachments from same source", () => {
      const attachments = [
        {
          slot: 1 as const,
          role: "LEAD" as const,
          image_url: "/helix1.png",
          caption: "Helix 1",
          source_surface: "helix" as const,
          source_url: "",
          captured_at_et: "",
          view: null,
        },
        {
          slot: 2 as const,
          role: "SUPPORT" as const,
          image_url: "/helix2.png",
          caption: "Helix 2",
          source_surface: "helix" as const,
          source_url: "",
          captured_at_et: "",
          view: null,
        },
      ];
      const err = validateAttachmentConstraints(attachments);
      assert.match(err || "", /same surface|diversify/);
    });

    it("allows single attachment even if it's the only source", () => {
      const attachments = [
        {
          slot: 1 as const,
          role: "LEAD" as const,
          image_url: "/helix.png",
          caption: "Helix",
          source_surface: "helix" as const,
          source_url: "",
          captured_at_et: "",
          view: null,
        },
      ];
      const err = validateAttachmentConstraints(attachments);
      assert.equal(err, null);
    });
  });
});
