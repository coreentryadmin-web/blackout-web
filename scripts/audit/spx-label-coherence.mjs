#!/usr/bin/env node
/**
 * SPX member-facing LABEL COHERENCE — live capture (SLAYER-MAP §8 item 7).
 *
 * Asks the one question §5 records and nothing checks: of the several gamma flips and max pains
 * the SPX desk legitimately computes, do the ones sharing a word agree — and do the ones that are
 * the same quantity share a word?
 *
 * THE CAPTURE IS THE HARD PART, not the comparison. Two values fetched a minute apart on a moving
 * tape disagree for a reason that has nothing to do with labelling, so every surface is fetched in
 * ONE Promise.all and the run refuses to grade a capture whose lanes came back too far apart in
 * time (--max-skew-ms). A "collision" measured across a stale lane is a false positive that costs
 * someone an afternoon.
 *
 * WHAT THIS SCRIPT CANNOT SEE, stated up front: it reads the API, and a member reads the DOM. The
 * LABELS below are a hand-maintained transcription of what the components render (see LABEL_MAP's
 * per-entry `src:` pointer). If a component is renamed without updating that map, this script
 * checks a fiction — it would report the OLD label as coherent. That coupling is the known limit
 * of the offline half; the DOM half belongs to live-ui-interaction-audit.mjs.
 *
 * Never GREEN on absence: a lane that returns null makes its label group INSUFFICIENT, never
 * "agrees". Exits non-zero on RED so it can gate; INSUFFICIENT exits non-zero too unless
 * --allow-insufficient, because a pre-open run with three dead lanes must not read as a pass.
 *
 * Read-only. One temp Clerk user via the shared audit-auth helper, always released.
 *
 * Run:  node --import tsx scripts/audit/spx-label-coherence.mjs [--base=https://blackouttrades.com]
 *                                                               [--tolerance=5] [--max-skew-ms=4000]
 *                                                               [--allow-insufficient] [--json]
 */
import {
  checkLabelCoherence,
  formatCoherenceReport,
} from "../../src/features/spx/lib/spx-label-coherence.ts";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const BASE = flag("base", "https://blackouttrades.com").replace(/\/$/, "");
const TOLERANCE_PTS = Number(flag("tolerance", "5"));
const MAX_SKEW_MS = Number(flag("max-skew-ms", "4000"));
const JSON_OUT = has("json");
const ALLOW_INSUFFICIENT = has("allow-insufficient");

/**
 * API field -> what a member actually reads, and what the number actually IS.
 *
 * `label` must match the component byte-for-byte; `src` is where to check that. `basis` is the
 * claim about the quantity — two entries sharing a basis are the same number and MUST agree
 * whatever they are called; two with different bases may legitimately differ however alike the
 * labels look.
 */
const LABEL_MAP = [
  {
    lane: "desk",
    path: "/api/market/spx/desk",
    fields: [
      {
        field: "gamma_flip",
        surface: "desk-header",
        label: "γ Flip",
        src: "SpxSniperHeader.tsx StatPill label",
        basis: "gamma-flip:near-term:matrix",
      },
      {
        field: "max_pain",
        surface: "desk-header",
        // NOTE: bare "Max Pain" until the OI/EFF disambiguation lands; update with that PR.
        label: "Max Pain",
        src: "SpxSniperHeader.tsx StatPill label",
        basis: "max-pain:near-term:oi",
      },
    ],
  },
  {
    lane: "flow",
    path: "/api/market/spx/flow",
    fields: [
      {
        field: "gamma_flip",
        surface: "flow-lane",
        label: "γ Flip",
        src: "SpxDeskFlow payload — rendered by the flow strip",
        basis: "gamma-flip:near-term:flow-snapshot",
      },
    ],
  },
  {
    lane: "pin",
    path: "/api/market/spx/pin",
    fields: [
      {
        field: "flip",
        surface: "pin-panel",
        label: "GAMMA FLIP",
        src: "SpxPinForecast.tsx level rail",
        basis: "gamma-flip:0dte:oi",
      },
      {
        field: "magnet.strike",
        surface: "pin-panel",
        label: "EFF MAX PAIN",
        src: "SpxPinForecast.tsx:281 KIND_LABEL",
        basis: "max-pain:0dte:oi+volume",
        /** Only a max_pain magnet is a max pain — a put_wall magnet is a different level entirely. */
        onlyWhen: (payload) => payload?.magnet?.kind === "max_pain",
      },
    ],
  },
];

function pluck(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

async function main() {
  // WARM THE SESSION BEFORE TIMING ANYTHING. The first authenticated fetch of a run pays the whole
  // Clerk temp-user mint (user create + sign-in token + FAPI ticket exchange + JWT), which measured
  // ~6s on the first live run — so an un-warmed capture reports a ~6s "skew" that is entirely the
  // handshake and downgrades every RED to INDETERMINATE, i.e. the guard would disarm the check
  // precisely when it fires. Warm on a lane we are about to read anyway; the result is discarded.
  try {
    await fetchAuditJson(BASE, LABEL_MAP[0].path);
  } catch {
    /* a cold-start failure is reported by the real capture below, with its lane named */
  }

  // ONE instant for every lane. Sequential fetches on a live tape measure movement, not labelling.
  const startedAt = Date.now();
  const results = await Promise.all(
    LABEL_MAP.map(async (lane) => {
      const at = Date.now();
      try {
        const payload = await fetchAuditJson(BASE, lane.path);
        return { lane, payload, at, fetchedMs: Date.now() - at, error: null };
      } catch (err) {
        return { lane, payload: null, at, fetchedMs: Date.now() - at, error: String(err?.message ?? err) };
      }
    })
  );
  const skewMs = Date.now() - startedAt;

  const values = [];
  const laneErrors = [];
  for (const r of results) {
    if (r.error) {
      laneErrors.push(`${r.lane.lane}: ${r.error}`);
    }
    for (const f of r.lane.fields) {
      if (f.onlyWhen && !f.onlyWhen(r.payload)) continue;
      const raw = r.payload == null ? null : pluck(r.payload, f.field);
      const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      values.push({ surface: f.surface, label: f.label, value, basis: f.basis });
    }
  }

  const report = checkLabelCoherence(values, TOLERANCE_PTS);

  // A capture whose lanes are too far apart in time cannot support a COLLISION verdict — the
  // spread could be the tape moving. Downgrade rather than report a number we cannot defend.
  const skewed = skewMs > MAX_SKEW_MS;
  const verdict = skewed && report.verdict === "RED" ? "INDETERMINATE" : report.verdict;

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          base: BASE,
          tolerance_pts: TOLERANCE_PTS,
          capture_skew_ms: skewMs,
          max_skew_ms: MAX_SKEW_MS,
          skew_exceeded: skewed,
          verdict,
          lane_errors: laneErrors,
          values,
          report,
        },
        null,
        2
      )
    );
  } else {
    console.log(`base=${BASE}  tolerance=${TOLERANCE_PTS}pts  capture skew=${skewMs}ms`);
    for (const e of laneErrors) console.log(`  LANE ERROR   ${e}`);
    if (skewed) {
      console.log(
        `  SKEW         capture spanned ${skewMs}ms (> ${MAX_SKEW_MS}ms) — a spread this wide may be the tape, not the labels`
      );
    }
    console.log(formatCoherenceReport(report));
    if (verdict !== report.verdict) console.log(`  -> downgraded to ${verdict} on capture skew`);
  }

  if (verdict === "RED") return 1;
  if (verdict === "INDETERMINATE") return 1;
  if (verdict === "INSUFFICIENT") return ALLOW_INSUFFICIENT ? 0 : 1;
  return 0;
}

main()
  .then(async (code) => {
    await releaseAuditClerkSession();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[spx-label-coherence] ${err?.message ?? err}`);
    await releaseAuditClerkSession();
    process.exit(1);
  });
