import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CAPTURE_LESSONS,
  isCitable,
  lessonsFor,
} from "@/lib/x-intel/capture-lessons";
import { X_INTEL_VIEW_CATALOG } from "@/lib/x-intel/view-catalog";
import { X_INTEL_SURFACES } from "@/lib/x-intel/queue-types";

const PLAYBOOK = "content/Screenshot-Playbook.md";

describe("capture lessons — the evidence tag is load-bearing", () => {
  it("every MEASURED lesson carries the observation behind it", () => {
    // A measurement with no observation is a claim wearing a measurement's badge.
    for (const l of CAPTURE_LESSONS.filter((x) => x.evidence === "MEASURED")) {
      assert.ok(l.observation && l.observation.length > 30, `${l.id} has no observation`);
      assert.ok(l.sample_size != null && l.sample_size > 0, `${l.id} is MEASURED with no n`);
    }
  });

  it("every HYPOTHESIS declares n=0 and says it is untested", () => {
    for (const l of CAPTURE_LESSONS.filter((x) => x.evidence === "HYPOTHESIS")) {
      assert.equal(l.sample_size, 0, `${l.id} claims a sample it does not have`);
      assert.match(l.lesson, /UNTESTED/, `${l.id} does not admit it is untested`);
    }
  });

  it("RULED lessons carry no invented sample size", () => {
    for (const l of CAPTURE_LESSONS.filter((x) => x.evidence === "RULED")) {
      assert.equal(l.sample_size, null, `${l.id} invented an n for an operator rule`);
    }
  });

  it("a HYPOTHESIS is never citable as a reason", () => {
    // It may guide a choice; it must not be written down as having justified one.
    for (const l of CAPTURE_LESSONS) {
      assert.equal(isCitable(l), l.evidence !== "HYPOTHESIS", l.id);
    }
  });

  it("has unique ids", () => {
    const ids = CAPTURE_LESSONS.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("capture lessons — wired to real things", () => {
  it("every lesson targets a real catalog view, a real surface, or *", () => {
    // A lesson about a view that does not exist is a lesson nothing will ever apply.
    const viewIds = new Set(X_INTEL_VIEW_CATALOG.map((v) => v.id));
    const surfaces = new Set<string>([...X_INTEL_SURFACES, "track_record"]);
    for (const l of CAPTURE_LESSONS) {
      const ok = l.applies_to === "*" || viewIds.has(l.applies_to) || surfaces.has(l.applies_to);
      assert.ok(ok, `${l.id} targets "${l.applies_to}", which is neither a view nor a surface`);
    }
  });

  it("lessonsFor resolves cross-cutting, surface and view-level rules together", () => {
    const l = lessonsFor("thermal.matrix").map((x) => x.id);
    assert.ok(l.includes("thermal-expiry-all"), "surface-level rule missing");
    assert.ok(l.includes("frame-level-before-crop"), "cross-cutting rule missing");
  });

  it("orders RULED before MEASURED before HYPOTHESIS", () => {
    const ev = lessonsFor("vector.desk").map((x) => x.evidence);
    const rank = { RULED: 0, MEASURED: 1, HYPOTHESIS: 2 } as const;
    for (let i = 1; i < ev.length; i += 1) {
      assert.ok(rank[ev[i]!] >= rank[ev[i - 1]!], "lessons are out of binding order");
    }
  });

  it("every surface the lane publishes has at least one lesson", () => {
    for (const s of X_INTEL_SURFACES) {
      assert.ok(lessonsFor(s).length > 0, `no lesson covers ${s}`);
    }
  });
});

describe("the playbook and the typed lessons do not drift", () => {
  const md = readFileSync(PLAYBOOK, "utf8");

  it("the playbook exists and states the n=0 position explicitly", () => {
    // The single most important honesty property of the document: it must not present
    // engagement beliefs as findings while there is no engagement data at all.
    assert.match(md, /no engagement data at all/i);
    assert.match(md, /n\s*=\s*0/);
  });

  it("the playbook keeps the performance register empty while n=0", () => {
    const zeroSample = CAPTURE_LESSONS.every((l) => l.evidence !== "MEASURED" || l.sample_size !== null);
    assert.ok(zeroSample);
    assert.match(md, /EMPTY — n = 0/);
  });

  it("the playbook covers every surface the catalog can capture", () => {
    const labels: Record<string, RegExp> = {
      thermal: /THERMAL/, helix: /HELIX/, vector: /VECTOR/,
      nighthawk: /NIGHT HAWK/, meridian: /MERIDIAN/,
      spx_slayer: /SPX SLAYER/, largo: /LARGO/,
    };
    for (const [surface, re] of Object.entries(labels)) {
      assert.match(md, re, `playbook has no section for ${surface}`);
    }
  });

  it("the playbook records the lessons log and the unexplored list", () => {
    assert.match(md, /## 5\. Lessons log/);
    assert.match(md, /## 6\. Unexplored/);
  });
});
