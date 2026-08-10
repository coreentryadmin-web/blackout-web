/**
 * VISUAL MANIFEST — the audit trail that ships beside every asset.
 *
 * WHAT PROBLEM THIS SOLVES. A graphic posted to X outlives its session, travels without its
 * context, and is seen by people who cannot check it. Six weeks later, "where did 7,764.93 come
 * from" has to be answerable from the artefact alone. The manifest is that answer: template,
 * snapshot instant, systems consulted, and every value the card actually drew with its source.
 *
 * `renderedValues` RECORDS WHAT WAS DRAWN, NOT WHAT WAS AVAILABLE. That distinction is the whole
 * point. A bundle field the template chose not to render is not a claim anybody made, so it does
 * not belong in an audit of claims. Templates therefore report their values through a
 * `ManifestRecorder` as they render, rather than the manifest being derived from the bundle after
 * the fact — derivation would log numbers that never appeared on the image.
 *
 * `omitted` is the mirror image: components the template deliberately skipped because the data was
 * absent. Recording them by name is what lets a reviewer distinguish "we had no flow data" from
 * "this template never had a flow block", which is exactly the ambiguity that makes an absent
 * number look like a hidden one.
 *
 * PURE: no IO. The caller decides where the manifest is stored.
 */

import type { VisualBundle, VisualManifest, VisualSize, VisualSystem, VisualTemplateId } from "./types";
import { sizeSpec } from "./sizes";

export type ManifestRecorder = {
  /** Record a value the card DREW. Called by templates at render time. */
  value: (label: string, value: string | null | undefined, source: VisualSystem, asOf?: string | null) => void;
  /** Record a component the card deliberately did not draw. */
  omit: (component: string) => void;
  readonly values: { label: string; value: string; source: VisualSystem; asOf?: string | null }[];
  readonly omissions: string[];
};

export function createRecorder(): ManifestRecorder {
  const values: { label: string; value: string; source: VisualSystem; asOf?: string | null }[] = [];
  const omissions: string[] = [];
  return {
    value(label, value, source, asOf) {
      // A null value is not a rendered value — it is an omission by another name, and logging it
      // as a claim would put a blank into the audit trail as though it had been shown.
      if (value == null || value === "") return;
      values.push({ label, value, source, asOf: asOf ?? null });
    },
    omit(component) {
      if (!omissions.includes(component)) omissions.push(component);
    },
    get values() {
      return values;
    },
    get omissions() {
      return omissions;
    },
  };
}

/**
 * A stable-ish id for the asset. Derived from the snapshot instant, template and size rather than
 * randomness, so re-rendering the SAME evidence for the same surface yields the same id — which is
 * what makes a manifest matchable to an asset found later. The counter suffix disambiguates two
 * renders of one snapshot within the same millisecond.
 */
let seq = 0;
export function assetId(template: VisualTemplateId, size: VisualSize, dataAsOf: string): string {
  const stamp = dataAsOf.replace(/[-:.TZ]/g, "").slice(0, 14);
  seq = (seq + 1) % 1000;
  return `${template.toLowerCase()}-${size}-${stamp}-${String(seq).padStart(3, "0")}`;
}

export function buildManifest(params: {
  template: VisualTemplateId;
  size: VisualSize;
  bundle: VisualBundle;
  recorder: ManifestRecorder;
  question?: string | null;
  renderedAtMs: number;
  replayOfTurn?: string | null;
}): VisualManifest {
  const spec = sizeSpec(params.size);
  return {
    version: 1,
    assetId: assetId(params.template, params.size, params.bundle.asOf),
    template: params.template,
    size: params.size,
    dimensions: { width: spec.width, height: spec.height },
    question: params.question ?? null,
    // The SNAPSHOT instant, not the encode instant. These differ, and only the first is a claim
    // about the market — conflating them would date a card to when someone pressed a button.
    dataAsOf: params.bundle.asOf,
    renderedAt: new Date(params.renderedAtMs).toISOString(),
    systemsQueried: params.bundle.systemsQueried,
    renderedValues: params.recorder.values,
    omitted: params.recorder.omissions,
    replayOfTurn: params.replayOfTurn ?? null,
  };
}

/**
 * Every number on the card must trace to a system. This is the check that would catch a template
 * hardcoding a figure into its layout — the one way a fabricated number could still reach an
 * asset despite the bundle's omission rule, because a literal in JSX never passes through the
 * bundle at all. Returns the offending labels; empty means clean.
 */
export function unsourcedValues(manifest: VisualManifest): string[] {
  const known: VisualSystem[] = ["THERMAL", "HELIX", "VECTOR", "SPX SLAYER", "NIGHT HAWK", "0DTE", "LARGO"];
  return manifest.renderedValues.filter((v) => !known.includes(v.source)).map((v) => v.label);
}
