/**
 * EVIDENCE BUNDLE — assembled from the turn that already happened.
 *
 * THE CENTRAL CONSTRAINT: this module makes NO market-data calls. It reads `capturedResults` (the
 * raw tool output the turn already fetched) and the answer envelope Largo already produced, and
 * reshapes them for rendering.
 *
 * Why that is non-negotiable: if the card re-queried, the graphic and the written answer would be
 * assembled from two different snapshots taken seconds apart. Both would be individually correct
 * and they would still contradict each other — spot 7,757.58 in the text and 7,758.12 on the
 * image. On a shareable asset that contradiction is permanent, travels without its context, and
 * cannot be checked by anyone who sees it. One snapshot, two renderings.
 *
 * THE OMISSION RULE, applied everywhere below: a value that is absent, non-finite, or structurally
 * unrecognised produces NO entry. Never 0, never "—", never a guess. Downstream, a template that
 * receives no levels draws no level map, and the manifest records the omission by name so a
 * reviewer can tell "deliberately absent" from "never designed". `formatX` helpers return null
 * rather than a placeholder string for exactly this reason.
 *
 * MATCHED BY STRUCTURE, NOT BY TOOL NAME — `capturedResults` is an untyped array with no record of
 * which tool produced which entry, the same constraint `system-reads-extract.ts` and
 * `gex-shift-extract.ts` already work under. Shape matching also means renaming a tool cannot
 * silently empty a card.
 *
 * PURE AND TOTAL apart from the caller-supplied clock: no IO, no throw.
 */

import type {
  VisualBundle,
  VisualLevel,
  VisualMetric,
  VisualNumber,
  VisualSystem,
  VisualSystemRead,
  VisualTimelineStep,
} from "./types";
import { extractGexShifts, formatGexChange } from "@/lib/largo/core/gex-shift-extract";
import { genericBlocksFrom } from "./generic-extract";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Price, grouped, 2dp for index-scale values and 2dp for equities alike. Null in → null out. */
export function fmtPrice(v: number | null): string | null {
  if (v == null) return null;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole-dollar price for strikes and walls, which are always round. */
export function fmtStrike(v: number | null): string | null {
  if (v == null) return null;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Signed percent with a TRUE minus sign (U+2212), matching the desk's own formatter. */
export function fmtPct(v: number | null, dp = 2): string | null {
  if (v == null) return null;
  const sign = v < 0 ? "−" : "+";
  return `${sign}${Math.abs(v).toFixed(dp)}%`;
}

/** Compact signed dollars: +$41.2M. */
export function fmtUsd(v: number | null): string | null {
  if (v == null) return null;
  const sign = v < 0 ? "−" : "+";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

/** ET clock from an ISO instant. Null when unparseable — a fabricated timestamp on a trade
 *  lifecycle is among the worst things this system could render. */
export function fmtEtTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    return new Date(t).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}

function vnum(value: number | null, display: string | null, source: VisualSystem, asOf?: string | null): VisualNumber | null {
  if (value == null || display == null) return null;
  return { value, display, source, asOf: asOf ?? null };
}

// ── Structural finders over capturedResults ────────────────────────────────────────────────

/** Dealer positioning: discriminated by `gamma_posture`, since `spot`/`flip` appear on several
 *  payloads (the same discriminator `system-reads-extract.ts` uses). */
function findPositioning(results: readonly unknown[]) {
  for (const r of results) {
    if (!isRecord(r) || !("gamma_posture" in r)) continue;
    return {
      spot: num(r.spot),
      flip: num(r.gamma_flip ?? r.flip),
      callWall: num(r.call_wall),
      putWall: num(r.put_wall),
      maxPain: num(r.max_pain),
      posture: str(r.gamma_posture),
      regimeRead: str(r.gamma_regime_read) ?? str(r.regime_read),
      asOf: str(r.asof) ?? str(r.as_of),
    };
  }
  return null;
}

/** A quote payload: carries a price and a ticker but no gamma posture. */
function findQuote(results: readonly unknown[]) {
  for (const r of results) {
    if (!isRecord(r) || "gamma_posture" in r) continue;
    const price = num(r.price) ?? num(r.last) ?? num(r.c);
    if (price == null) continue;
    return {
      price,
      ticker: str(r.ticker) ?? str(r.symbol),
      changePct: num(r.change_percent) ?? num(r.changePct) ?? num(r.percent_change),
      change: num(r.change) ?? num(r.change_absolute),
      asOf: str(r.asof) ?? str(r.as_of) ?? str(r.updated_at),
    };
  }
  return null;
}

/** A flow tape: `recent` array of premium-bearing prints. */
function findFlow(results: readonly unknown[]) {
  for (const r of results) {
    if (!isRecord(r) || !Array.isArray(r.recent)) continue;
    let net = 0;
    let gross = 0;
    let count = 0;
    for (const p of r.recent) {
      if (!isRecord(p)) continue;
      const prem = num(p.premium);
      if (prem == null || prem <= 0) continue;
      const isPut = String(p.option_type ?? "").toUpperCase().startsWith("P");
      net += isPut ? -prem : prem;
      gross += prem;
      count++;
    }
    if (count > 0) return { net, gross, count };
  }
  return null;
}

/** A ledger/board payload carrying committed rows. */
function findLedgerRows(results: readonly unknown[]): Record<string, unknown>[] | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    const rows = r.rows ?? r.ledger ?? r.committed ?? r.sample_plays ?? r.plays;
    if (!Array.isArray(rows) || !rows.length) continue;
    const recs = rows.filter(isRecord);
    if (recs.length) return recs;
  }
  return null;
}

/**
 * GATE-BLOCKED VALUE → the counterfactual card.
 *
 * Discriminated by `by_gate` + `blocked_total`, which no other payload carries.
 *
 * COUNTS, NOT P&L. The persisted production measurement is a win/loss verdict per blocked play, so
 * `pnlDisplay` is deliberately left absent rather than synthesised — the card renders counts and
 * labels the net as plays. See `types.ts` on `counterfactual`.
 */
function findGateValue(results: readonly unknown[]) {
  for (const r of results) {
    if (!isRecord(r) || !Array.isArray(r.by_gate) || typeof r.blocked_total !== "number") continue;
    return r as {
      blocked_total: number;
      graded_total: number;
      would_have_won_total: number;
      would_have_lost_total: number;
      unfilled_total: number;
      window_days: number;
      by_gate: Record<string, unknown>[];
    };
  }
  return null;
}

/** GRADER AGREEMENT → the grader-agreement card. Discriminated by `agreement_pct` + `comparable`. */
function findGraderAgreement(results: readonly unknown[]) {
  for (const r of results) {
    if (!isRecord(r) || !("agreement_pct" in r) || typeof r.comparable !== "number") continue;
    return r as {
      window_days: number;
      total_plays: number;
      comparable: number;
      agreed: number;
      agreement_pct: number | null;
      grader_a: string;
      grader_b: string;
      disagreements: { ticker: string; date: string | null; mid: string; official: string }[];
    };
  }
  return null;
}

// ── Playbook (forward runbook) ──────────────────────────────────────────────────────────────

/**
 * Find a published Night Hawk EDITION in the turn's tool output.
 *
 * Discriminated on `plays` + at least one of `edition_for` / `published_at` / `recap_headline`,
 * which together no other payload in the system carries. Matching on `plays` alone would also
 * catch the 0DTE board's committed rows, and those ARE trades — they belong to TRADE_RECAP.
 *
 * An edition with `available: false` is not a playbook: it is the absence of one, and a card built
 * from it would present "nothing published yet" as an empty book.
 */
function findEdition(results: readonly unknown[]): Record<string, unknown> | null {
  for (const r of results) {
    if (!isRecord(r) || !Array.isArray(r.plays)) continue;
    const looksLikeEdition =
      "edition_for" in r || "published_at" in r || "recap_headline" in r || "recap_only" in r;
    if (!looksLikeEdition) continue;
    if (r.available === false) continue;
    return r;
  }
  return null;
}

/**
 * Build the runbook block from a published edition.
 *
 * EVERY LEVEL IS QUOTED, NOT PARSED. `entry_range`, `target` and `stop` arrive as strings the
 * engine composed ("$182.40–183.10"). They are carried through untouched. Re-parsing them into
 * numbers to reformat would introduce a second formatter for values the desk already renders one
 * way, and a runbook whose levels differ from the desk's by a rounding step is worse than none.
 *
 * A PLAY WITH NO LEVELS AT ALL IS DROPPED, and the drop is visible: `totalPlays` counts what the
 * edition published, while `rows` holds what can actually be drawn, so the card's own "showing N
 * of M" line reports the gap rather than hiding it.
 */
export function playbookFromEdition(
  edition: Record<string, unknown>,
  source: VisualSystem = "NIGHT HAWK"
): VisualBundle["playbook"] {
  const raw = Array.isArray(edition.plays) ? edition.plays.filter(isRecord) : [];
  if (!raw.length) return null;

  const rows = raw
    .map((p, i) => {
      const ticker = str(p.ticker);
      if (!ticker) return null;
      const dirRaw = String(p.direction ?? "").toLowerCase();
      const premium = num(p.entry_premium);
      return {
        rank: num(p.rank) ?? i + 1,
        ticker,
        direction: (dirRaw.startsWith("s") || dirRaw === "put" ? "short" : "long") as "long" | "short",
        conviction: str(p.conviction),
        entryRange: str(p.entry_range),
        target: str(p.target),
        stop: str(p.stop),
        optionsPlay: str(p.options_play),
        entryPremium: premium,
        entryPremiumDisplay: premium != null ? `$${premium.toFixed(2)}` : null,
        thesis: str(p.thesis),
        keySignal: str(p.key_signal),
        rrRatio: num(p.rr_ratio),
        targetAtrMultiple: num(p.target_atr_multiple),
        earningsRisk: p.earnings_risk === true,
        pulled: p.pulled === true,
        pulledReason: str(p.pulled_reason),
        gatePromoted: p.gate_promoted === true,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    // A row with no entry, no target and no stop carries nothing a member could act on. Keep it
    // ONLY when it is pulled — a withdrawal is actionable information even without levels.
    .filter((r) => r.pulled || !!(r.entryRange || r.target || r.stop))
    .sort((a, b) => a.rank - b.rank);

  if (!rows.length) return null;

  return {
    editionFor: str(edition.edition_for) ?? str(edition.served_for),
    publishedAt: str(edition.published_at),
    // Counted off the edition's own array, so truncation and undrawable rows are both visible.
    totalPlays: raw.length,
    noPlays: edition.no_plays === true,
    stale: edition.stale === true,
    degraded: edition.degraded === true,
    rows,
    source,
  };
}

// ── Trade lifecycle ────────────────────────────────────────────────────────────────────────

/**
 * Build the trade block from a ledger row.
 *
 * GRADING HONESTY. `graded` is carried through and a row that is NOT graded never renders an
 * outcome — it renders as OPEN with its live mark. This is the marketing-surface application of
 * the P0 record-honesty finding: today's closed-but-ungraded rows are exactly the ones a recap
 * graphic would most want to claim, and claiming a result the ledger has not graded is the single
 * most damaging thing this renderer could do.
 *
 * Real ledger keys, verified live against prod (a prior probe used guessed names and read `—`
 * everywhere, which is indistinguishable from a dead lane): `last_mark`, `live_pnl_pct`,
 * `exit_pnl_pct`, `mark_as_of`, `entry_premium`, `underlying_at_flag`.
 */
export function tradeFromLedgerRow(row: Record<string, unknown>, source: VisualSystem = "NIGHT HAWK"): VisualBundle["trade"] {
  const ticker = str(row.ticker);
  if (!ticker) return null;

  const dirRaw = String(row.direction ?? "").toLowerCase();
  const direction: "long" | "short" = dirRaw.startsWith("s") || dirRaw === "put" ? "short" : "long";

  const entryPremium = num(row.entry_premium) ?? num(row.entry);
  const entry = vnum(entryPremium, entryPremium != null ? `$${entryPremium.toFixed(2)}` : null, source, str(row.committed_at) ?? str(row.created_at));
  if (!entry) return null; // no entry ⇒ not a trade

  const mark = num(row.last_mark);
  const status = str(row.status);
  const graded = row.graded === true;

  const exitPct = num(row.exit_pnl_pct);
  const livePct = num(row.live_pnl_pct);
  const peakPct = num(row.peak_pnl_pct) ?? num(row.max_pnl_pct);

  // An outcome label is only carried when the row is officially graded.
  const outcome = graded ? str(row.plan_outcome) ?? str(row.outcome) : null;

  return {
    ticker,
    direction,
    contract: str(row.contract) ?? str(row.option_ticker) ?? str(row.top_strike),
    entry,
    exit: vnum(mark, mark != null ? `$${mark.toFixed(2)}` : null, source, str(row.mark_as_of)),
    peak: null,
    // The return shown is the graded one when graded, otherwise the LIVE mark-to-market — and the
    // template labels it accordingly, so an open position is never presented as a booked result.
    returnPct: vnum(graded ? exitPct : livePct, fmtPct(graded ? exitPct : livePct, 1), source, str(row.mark_as_of)),
    peakReturnPct: vnum(peakPct, fmtPct(peakPct, 1), source),
    status,
    graded,
    outcome,
    source,
  };
}

// ── The bundle ─────────────────────────────────────────────────────────────────────────────

export type BuildBundleInput = {
  capturedResults?: readonly unknown[] | null;
  /** The answer's own verdict line — reused verbatim, never regenerated. */
  headline?: string | null;
  summary?: string | null;
  bias?: "bull" | "bear" | "neutral" | null;
  ticker?: string | null;
  /** Levels the answer envelope already lifted, so card and text quote one set. */
  envelopeLevels?: { label: string; value: number | string }[] | null;
  /** Explicit ledger row for a trade recap, when the caller has one in hand. */
  ledgerRow?: Record<string, unknown> | null;
  /**
   * GEX shifts the ANSWER ENVELOPE already carries.
   *
   * The client mount point has the envelope but not `capturedResults` (raw tool output never
   * crosses to the browser), and the envelope's `gexShifts` were themselves lifted structurally
   * off the same tool result — so taking them here keeps the card on one snapshot without
   * shipping the whole tool payload to the client.
   */
  envelopeGexShifts?: { strike: number; change: number; direction: "stronger" | "weaker" | "flipped" }[] | null;
  /** Spot the envelope already resolved, when no positioning payload is in hand. */
  envelopeSpot?: number | null;
  nowMs: number;
};

/**
 * Assemble the bundle. Every block is independently optional; an empty bundle is a valid result
 * and simply means no visual can be offered.
 */
export function buildVisualBundle(input: BuildBundleInput): VisualBundle {
  const results = input.capturedResults ?? [];
  const systems = new Set<VisualSystem>();

  const pos = findPositioning(results);
  const quote = findQuote(results);
  const flow = findFlow(results);
  const gex = extractGexShifts(results);

  if (pos) systems.add("THERMAL");
  if (flow) systems.add("HELIX");
  if (gex) systems.add("THERMAL");

  // ── Spot: positioning first, quote second. One instrument, one number. Preferring positioning
  // keeps spot on the same snapshot as the walls drawn beside it.
  const spotVal = pos?.spot ?? quote?.price ?? input.envelopeSpot ?? null;
  const spotSource: VisualSystem = pos?.spot != null ? "THERMAL" : "VECTOR";
  const spot = vnum(spotVal, fmtPrice(spotVal), spotSource, pos?.asOf ?? quote?.asOf);
  if (spot) systems.add(spotSource);

  // ── Levels
  const levels: VisualLevel[] = [];
  const pushLevel = (label: string, price: number | null, kind: VisualLevel["kind"], source: VisualSystem) => {
    if (price == null) return;
    const display = fmtStrike(price);
    if (display == null) return;
    const distance = spotVal != null && spotVal !== 0 ? fmtPct(((price - spotVal) / spotVal) * 100) : null;
    levels.push({ label, price, display, kind, source, distance });
  };
  if (pos) {
    pushLevel("Call wall", pos.callWall, "resistance", "THERMAL");
    pushLevel("Gamma flip", pos.flip, "pivot", "THERMAL");
    pushLevel("Put wall", pos.putWall, "support", "THERMAL");
    pushLevel("Max pain", pos.maxPain, "level", "THERMAL");
  }
  // Envelope levels fill gaps the positioning read did not cover — deduped by label so the same
  // level cannot appear twice under two sources.
  for (const l of input.envelopeLevels ?? []) {
    const label = str(l.label);
    const price = num(l.value) ?? num(Number(l.value));
    if (!label || price == null) continue;
    if (levels.some((x) => x.label.toLowerCase() === label.toLowerCase())) continue;
    pushLevel(label, price, "level", "LARGO");
  }

  // ── Metrics
  const metrics: VisualMetric[] = [];
  if (flow) {
    const d = fmtUsd(flow.net);
    if (d) {
      metrics.push({
        label: "Net premium",
        value: d,
        tone: flow.net > 0 ? "positive" : flow.net < 0 ? "negative" : "neutral",
        sub: `${flow.count} prints`,
        source: "HELIX",
        fact: "net_premium",
      });
    }
  }
  if (pos?.posture) {
    metrics.push({
      label: "Dealer gamma",
      value: pos.posture.toUpperCase(),
      tone: "caution",
      sub: pos.regimeRead,
      source: "THERMAL",
      fact: "gamma_posture",
    });
  }
  if (quote?.changePct != null) {
    const d = fmtPct(quote.changePct);
    if (d) {
      metrics.push({
        label: "Session",
        value: d,
        tone: quote.changePct >= 0 ? "positive" : "negative",
        source: "VECTOR",
        fact: "session_change",
      });
    }
  }

  // ── System reads
  const systemReads: VisualSystemRead[] = [];
  if (flow) {
    const share = flow.gross > 0 ? Math.abs(flow.net) / flow.gross : 0;
    systemReads.push({
      system: "HELIX",
      // A weak net inside a large gross is not a direction — the same threshold system-reads.ts
      // applies, so the card and the consensus strip agree.
      stance: share < 0.15 ? "neutral" : flow.net > 0 ? "bullish" : "bearish",
      detail: fmtUsd(flow.net),
      fact: "net_premium",
    });
  }
  if (pos?.posture) {
    systemReads.push({ system: "THERMAL", stance: "regime", detail: `${pos.posture} gamma`, fact: "gamma_posture" });
  }

  // ── Playbook (the forward book) — resolved BEFORE the trade, because an edition's `plays` array
  // is also what `findLedgerRows` matches on. Without this, tomorrow's five published plays were
  // read as one committed trade and four were discarded. See `playbookFromEdition`.
  const editionRaw = findEdition(results);
  const playbook = editionRaw ? playbookFromEdition(editionRaw) : null;
  if (playbook) systems.add(playbook.source);

  // ── Trade
  //
  // An edition is EXCLUDED as a trade source. A published play has an entry premium and nothing
  // else TRADE_RECAP reads — no mark, no return, no status — so it satisfied that template's
  // "has an entry" gate and then rendered as a card of empty cells. A plan is not a trade.
  const ledgerRow =
    input.ledgerRow ?? (playbook ? null : findLedgerRows(results)?.[0]) ?? null;
  const trade = ledgerRow ? tradeFromLedgerRow(ledgerRow) : null;
  if (trade) systems.add(trade.source);

  // ── Counterfactual (gate-blocked value)
  //
  // ROWS COME FROM THE PER-GATE LINES, and each line is one GATE rather than one play. The card's
  // row shape wants a ticker, and the aggregate does not carry per-play tickers — so the gate name
  // occupies the primary slot and the count travels as the outcome. Inventing a ticker to fill the
  // shape would be fabrication; showing the gate is what the evidence supports.
  const gv = findGateValue(results);
  const counterfactual: VisualBundle["counterfactual"] = gv && gv.graded_total > 0
    ? {
        sessionLabel: `last ${gv.window_days} days`,
        guardLabel: "Night Hawk publish gates",
        heldCount: gv.blocked_total,
        gradedCount: gv.graded_total,
        losersAvoided: { count: gv.would_have_lost_total },
        winnersForgone: { count: gv.would_have_won_total },
        unfilledCount: gv.unfilled_total,
        rows: gv.by_gate
          .map((line) => {
            const gate = str(line.gate);
            const won = num(line.would_have_won) ?? 0;
            const graded = num(line.graded_n) ?? 0;
            const unfilled = num(line.unfilled_n) ?? 0;
            const decisive = graded - unfilled;
            if (!gate || decisive <= 0) return null;
            const lost = decisive - won;
            // One row per gate, taking the side that gate actually landed on. A gate that both
            // saved and cost is reported by its NET so the row cannot claim more than it earned.
            const forgone = won > lost;
            return {
              ticker: gate.toUpperCase().slice(0, 18),
              gate: `${decisive} graded`,
              outcomeDisplay: forgone ? `${won} would have won` : `${lost} would have lost`,
              verdict: (forgone ? "forgone" : "avoided") as "forgone" | "avoided",
            };
          })
          .filter((r): r is NonNullable<typeof r> => r != null),
        source: "NIGHT HAWK",
      }
    : null;
  if (counterfactual) systems.add("NIGHT HAWK");

  // ── Grader agreement
  const ga = findGraderAgreement(results);
  const graderAgreement: VisualBundle["graderAgreement"] = ga && ga.comparable > 0 && ga.agreement_pct != null
    ? {
        windowLabel: `${ga.window_days} days`,
        populationLabel: "rows carrying a grade on BOTH the mid and executable lanes",
        totalPlays: ga.total_plays,
        comparable: ga.comparable,
        agreed: ga.agreed,
        agreementDisplay: `${ga.agreement_pct}%`,
        graderALabel: ga.grader_a,
        graderBLabel: ga.grader_b,
        rows: ga.disagreements.map((d) => ({
          ticker: d.ticker,
          dateLabel: d.date,
          a: d.mid,
          b: d.official,
        })),
        source: "NIGHT HAWK",
      }
    : null;
  if (graderAgreement) systems.add("NIGHT HAWK");

  // ── Freshness, from the oldest stamp we have.
  const stamps = [pos?.asOf, quote?.asOf].filter((x): x is string => !!x).map((x) => Date.parse(x)).filter(Number.isFinite);
  const oldest = stamps.length ? Math.min(...stamps) : null;
  const ageMs = oldest != null ? input.nowMs - oldest : null;
  const freshness: VisualBundle["freshness"] =
    ageMs == null ? "unknown" : ageMs < 60_000 ? "live" : ageMs < 600_000 ? "recent" : "stale";

  if (input.headline) systems.add("LARGO");

  return {
    ticker: input.ticker ?? quote?.ticker ?? null,
    headline: input.headline ?? null,
    summary: input.summary ?? null,
    bias: input.bias ?? null,
    spot,
    change: null,
    levels,
    metrics,
    timeline: [],
    systemReads,
    // Tool result first, envelope second — both are the same underlying tool output, and
    // preferring the raw one keeps the richer `asOf` metadata when it is available.
    gexShifts:
      gex?.shifts.map((s) => ({ ...s, display: formatGexChange(s.change) })) ??
      (input.envelopeGexShifts?.length
        ? input.envelopeGexShifts.map((s) => ({ ...s, display: formatGexChange(s.change) }))
        : undefined),
    regime: pos?.posture ? { label: pos.posture.toUpperCase(), detail: pos.regimeRead, source: "THERMAL" } : null,
    /**
     * GENERIC BLOCKS, from everything the purpose-built finders did NOT claim.
     *
     * Resolved LAST so `claimed` is complete. A payload already rendered as a flow tape must not
     * also render as a generic ranked list — the same numbers under two headings read as two
     * independent measurements.
     */
    ...(() => {
      /**
       * THE CLAIMED SET MUST HOLD SOURCE RECORDS, and the derived finders do not return them.
       *
       * Caught by rendering. `findQuote`/`findFlow`/`findPositioning` each build a NEW object from
       * the payload they matched, so `claimed.has(record)` never fired and the quote was rendered
       * TWICE — once as the hero spot, once as a "Readings" tile saying "Price $217.42". Two
       * renderings of one number read as two independent measurements.
       *
       * So membership is recomputed against the raw records using the same discriminators the
       * finders use, rather than trusting their return values to be identity-comparable.
       */
      const claimed = new Set<unknown>([editionRaw, ledgerRow, gv].filter((x) => x != null));
      for (const r of results) {
        if (!isRecord(r)) continue;
        const isQuote = num(r.price) != null || num(r.last) != null || num(r.c) != null;
        const isFlowTape = Array.isArray(r.recent);
        const isPositioning = "gamma_posture" in r || "flip" in r;
        const isGrader = "agreed" in r && "comparable" in r;
        if (isQuote || isFlowTape || isPositioning || isGrader) claimed.add(r);
      }
      const g = genericBlocksFrom(results, claimed);
      return { genericStats: g.stats, genericRanked: g.ranked, genericEvents: g.events };
    })(),
    playbook,
    trade,
    counterfactual,
    graderAgreement,
    systemsQueried: [...systems],
    asOf: new Date(oldest ?? input.nowMs).toISOString(),
    freshness,
  };
}

/** Timeline steps from a ledger row's lifecycle stamps. Only stamps that PARSE become steps. */
export function timelineFromLedgerRow(row: Record<string, unknown>): VisualTimelineStep[] {
  const steps: VisualTimelineStep[] = [];
  const add = (label: string, iso: unknown, detail?: string | null, tone?: VisualTimelineStep["tone"]) => {
    const time = fmtEtTime(str(iso));
    if (!time) return; // no real timestamp ⇒ no step
    steps.push({ label, time, detail: detail ?? null, tone: tone ?? "neutral" });
  };
  add("Detected", row.detected_at ?? row.created_at, null, "neutral");
  add("Committed", row.committed_at, str(row.contract) ?? str(row.top_strike), "positive");
  add("Exit", row.closed_at ?? row.exited_at, str(row.exit_reason), row.graded === true ? "positive" : "neutral");
  return steps;
}
