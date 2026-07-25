/**
 * VETO-FLICKER-RATE MEASUREMENT (design item #2 — Cortex veto has no hysteresis/latching).
 *
 * `evaluateCortexForCommit` (cortex-gate.ts) recomputes the Cortex verdict FRESH on every scan pass —
 * a veto is stateless: it neither latches (stay vetoed once vetoed) nor dwells (require the block to
 * persist for K passes before it bites). That is a deliberate choice — Cortex is a precision layer that
 * can only ever REMOVE plays, and a stale latched veto would suppress a genuinely-cleared setup. But it
 * has a measurable cost: a veto that FLICKERS (fires on one pass, clears the next, fires again) either
 * (a) whipsaws a candidate in and out of the board, or (b) reflects a real, unstable signal. This
 * harness measures the flicker rate so a dwell/hysteresis decision is evidence-driven, not a guess.
 *
 * DEFINITION. For each ticker over a session's ordered scan passes, a "veto episode" is a maximal run of
 * consecutive passes on which a Cortex VETO (`cortex_veto:<source>` or the veto-blind firewall
 * `cortex_veto_blind`) was in force for that ticker. The episode "CLEARED within N" when the SAME ticker
 * reappears as a candidate with a NON-veto Cortex decision within N passes of the run's end. Flicker
 * rate = cleared-within-N episodes / total episodes; also reports median passes-to-clear and the
 * ticker-level churn (episodes per ticker).
 *
 * OFFLINE + READ-ONLY. It changes NO production behavior — it only tallies persisted per-pass decisions.
 * It does NOT re-run Cortex (that needs the live UW/provider inputs whose env-config indirection does
 * not bind in this sandbox, and only a same-day replay would be honest anyway).
 *
 * DATA. Two accepted inputs (both DB/scan-log products; raw Postgres is blocked here, so pass an export):
 *   --passes=<path.json>   PREFERRED: per-pass candidate rosters WITH each candidate's cortex decision —
 *                          [{ pass_at, candidates: [{ ticker, cortex_decision }] }] where cortex_decision
 *                          ∈ PASS|VETO|VETO_BLIND|NET_NEGATIVE|ABSTAIN (cortex-gate ZeroDteCortexDecision).
 *                          This is the only input that can distinguish "cleared" from "not a candidate
 *                          this pass", so flicker is measured exactly.
 *   --rejections=<path.json>  FALLBACK (coarser): zerodte_scan_rejections rows [{ ts, ticker, code }] (or
 *                          { gate_failed }). Only rows whose code starts with "cortex_veto" are veto
 *                          passes; the FIRST pass a vetoed ticker is absent from the rejections is treated
 *                          as "cleared" — APPROXIMATE (absence can also mean "not a candidate"), so the
 *                          output is flagged approximate.
 * With neither input it prints INSUFFICIENT DATA and exactly what it needs — it never fabricates a series.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/veto-flicker-rate.mjs --passes=export.json [--within=3] [--json]
 */
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const WITHIN = Math.max(1, Number(argv.within ?? 3));
const JSON_OUT = argv.json === true || argv.json === "true";

/** Cortex decisions that constitute a VETO for flicker purposes (cortex-gate ZeroDteCortexDecision +
 *  the persisted rejection-code prefix). A NET_NEGATIVE/ABSTAIN block is NOT a veto — it is a score
 *  floor, not the veto channel this item is about, so it counts as "not vetoed" (a clear). */
const VETO_DECISIONS = new Set(["VETO", "VETO_BLIND"]);
const isVetoCode = (code) => typeof code === "string" && code.startsWith("cortex_veto");

function insufficient(reason) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  } else {
    console.log(`\n=== veto-flicker-rate — INSUFFICIENT DATA ===`);
    console.log(reason);
    console.log(
      "\nProvide EITHER:\n" +
        "  --passes=<path.json>      [{ pass_at, candidates: [{ ticker, cortex_decision }] }, …]  (exact)\n" +
        "  --rejections=<path.json>  [{ ts, ticker, code }, …] from zerodte_scan_rejections     (approximate)\n" +
        "Produce it where the scan log / rejections DB is reachable (raw Postgres is blocked from this\n" +
        "sandbox), one session per export, ordered passes. Then re-run here to tally flicker offline."
    );
  }
  process.exit(0);
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function readJson(path) {
  const fs = await import("node:fs/promises");
  const txt = await fs.readFile(path, "utf8");
  return JSON.parse(txt);
}

/** Build ordered per-ticker veto-presence series from the PREFERRED --passes input.
 *  Returns Map<ticker, boolean[]> aligned to the pass index, where true = vetoed on that pass,
 *  false = a candidate that pass but NOT vetoed, undefined = not a candidate that pass. */
function seriesFromPasses(passes) {
  const ordered = [...passes].sort((a, b) => String(a.pass_at ?? a.ts ?? "").localeCompare(String(b.pass_at ?? b.ts ?? "")));
  const tickers = new Set();
  for (const p of ordered) for (const c of p.candidates ?? []) tickers.add(String(c.ticker).toUpperCase());
  const series = new Map();
  for (const t of tickers) series.set(t, new Array(ordered.length).fill(undefined));
  ordered.forEach((p, i) => {
    for (const c of p.candidates ?? []) {
      const t = String(c.ticker).toUpperCase();
      series.get(t)[i] = VETO_DECISIONS.has(String(c.cortex_decision).toUpperCase());
    }
  });
  return { series, nPasses: ordered.length, approximate: false };
}

/** Build the same series from the coarser --rejections input. Absence of a cortex_veto row for a
 *  ticker on a pass is treated as "candidate present, not vetoed" (false) — APPROXIMATE. Passes are
 *  the distinct timestamps present in the export. */
function seriesFromRejections(rows) {
  const passKey = (r) => String(r.ts ?? r.pass_at ?? r.created_at ?? "");
  const passes = [...new Set(rows.map(passKey))].filter(Boolean).sort();
  const idxOf = new Map(passes.map((p, i) => [p, i]));
  const tickers = new Set(rows.map((r) => String(r.ticker).toUpperCase()));
  const series = new Map();
  for (const t of tickers) series.set(t, new Array(passes.length).fill(false));
  for (const r of rows) {
    const code = r.code ?? r.gate_failed ?? r.gate_code;
    if (!isVetoCode(code)) continue;
    const i = idxOf.get(passKey(r));
    const t = String(r.ticker).toUpperCase();
    if (i != null && series.has(t)) series.get(t)[i] = true;
  }
  return { series, nPasses: passes.length, approximate: true };
}

let built;
if (typeof argv.passes === "string") {
  const parsed = await readJson(argv.passes).catch((e) => {
    console.error(`Could not read --passes=${argv.passes}: ${e?.message ?? e}`);
    process.exit(2);
  });
  const passes = Array.isArray(parsed) ? parsed : (parsed.passes ?? parsed.rows ?? []);
  if (!Array.isArray(passes) || passes.length === 0) insufficient(`--passes=${argv.passes} contained no passes.`);
  built = seriesFromPasses(passes);
} else if (typeof argv.rejections === "string") {
  const parsed = await readJson(argv.rejections).catch((e) => {
    console.error(`Could not read --rejections=${argv.rejections}: ${e?.message ?? e}`);
    process.exit(2);
  });
  const rows = Array.isArray(parsed) ? parsed : (parsed.rejections ?? parsed.rows ?? []);
  if (!Array.isArray(rows) || rows.length === 0) insufficient(`--rejections=${argv.rejections} contained no rows.`);
  built = seriesFromRejections(rows);
} else {
  insufficient("No --passes or --rejections export was provided, so there is no per-pass veto series to measure.");
}

const { series, nPasses, approximate } = built;

// ── Tally episodes ──────────────────────────────────────────────────────────────────────
// An episode = a maximal run of consecutive vetoed passes for a ticker. It "cleared within N" when the
// ticker reappears (candidate present) with a NON-veto decision (false) within N passes after the run.
let episodes = 0;
let clearedWithinN = 0;
let neverCleared = 0;
const passesToClear = [];
const churn = []; // { ticker, episodes }
const perTicker = [];

for (const [ticker, s] of series) {
  let tEpisodes = 0;
  let i = 0;
  while (i < s.length) {
    if (s[i] !== true) {
      i++;
      continue;
    }
    // start of a veto run
    const runStart = i;
    while (i < s.length && s[i] === true) i++;
    const runEnd = i - 1; // inclusive last vetoed pass
    episodes++;
    tEpisodes++;
    // Look forward for the first pass where the ticker is a candidate and NOT vetoed (=== false).
    let cleared = false;
    let distance = null;
    for (let j = runEnd + 1; j < s.length; j++) {
      if (s[j] === false) {
        cleared = true;
        distance = j - runEnd;
        break;
      }
      // s[j] === true would be a new run (can't happen — the while above consumed the whole run);
      // s[j] === undefined = not a candidate that pass → keep looking within the window bound below.
      if (j - runEnd >= WITHIN && s[j] !== false) break;
    }
    if (cleared && distance != null && distance <= WITHIN) {
      clearedWithinN++;
      passesToClear.push(distance);
    } else if (cleared) {
      // cleared but only AFTER the N-pass window
      passesToClear.push(distance);
    } else {
      neverCleared++;
    }
  }
  if (tEpisodes > 0) {
    churn.push({ ticker, episodes: tEpisodes });
    perTicker.push({ ticker, episodes: tEpisodes });
  }
}

if (episodes === 0) {
  insufficient(
    `Read ${series.size} ticker series over ${nPasses} pass(es) but found ZERO Cortex veto episodes — no\n` +
      `veto ever fired on this export. Nothing to measure (this is a clean, not a broken, result).`
  );
}

const flickerRate = clearedWithinN / episodes;
const churnSorted = churn.sort((a, b) => b.episodes - a.episodes);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        approximate,
        within_passes: WITHIN,
        passes: nPasses,
        tickers_with_a_veto: perTicker.length,
        veto_episodes: episodes,
        cleared_within_n: clearedWithinN,
        never_cleared: neverCleared,
        flicker_rate: flickerRate,
        median_passes_to_clear: median(passesToClear),
        top_churn: churnSorted.slice(0, 15),
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`\n=== CORTEX VETO-FLICKER RATE ${approximate ? "(APPROXIMATE — from rejections)" : "(exact — from per-pass rosters)"} ===`);
console.log(`passes ${nPasses} · tickers that saw a veto ${perTicker.length} · veto episodes ${episodes}\n`);
console.log(`flicker: episodes that CLEARED within ${WITHIN} pass(es) = ${clearedWithinN}/${episodes}  →  ${(flickerRate * 100).toFixed(1)}%`);
console.log(`never cleared (veto held to session end / only cleared later): ${neverCleared}`);
console.log(`median passes-to-clear (of those that cleared): ${median(passesToClear) ?? "n/a"}`);
console.log(`\ntop veto churn (episodes per ticker):`);
for (const c of churnSorted.slice(0, 12)) console.log(`  · ${c.ticker.padEnd(6)} ${c.episodes} episode(s)`);
const verdict =
  flickerRate >= 0.5
    ? `⚠ ≥50% of veto episodes cleared within ${WITHIN} passes — high flicker. A short dwell/hysteresis (require the veto to persist K passes, or latch it for K passes once fired) is worth a calibrated trial.`
    : `flicker is modest (<50% cleared within ${WITHIN}) — the stateless veto is not obviously whipsawing; hysteresis would trade responsiveness for little stability gain on this sample.`;
console.log(`\nVerdict: ${verdict}`);
if (approximate)
  console.log(
    `\nNOTE: from --rejections, so "cleared" conflates "Cortex passed it" with "it was no longer a candidate".\n` +
      `Feed --passes (per-pass rosters with cortex_decision) for the exact rate.`
  );
console.log(`\n(FLICKER PROBE — measures the stateless-veto cost. Cortex is recomputed each pass by design (cortex-gate.ts). Evidence for a dwell decision, not a gate. No production behavior touched.)`);
