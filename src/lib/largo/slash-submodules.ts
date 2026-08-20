/**
 * Stable desk submodules — the second CLI layer after desk scope.
 * Grammar: `/ <desk> [ <submodule> ] [ <ticker> ] [ <modifier> ]`
 * Example: `/spx-slayer /gex`, `/helix /whales NVDA`, `/thermal /compare mag7`
 *
 * Client-safe: static metadata only. Prefetch/mini-panel slices live in server modules.
 */

import type { DeskScopeKey } from "@/lib/largo/desk-scope";

export type DeskSubmoduleDef = {
  id: string;
  label: string;
  /** Filter tokens — includes id and common abbreviations. */
  aliases: string[];
  description: string;
  rank: number;
  /** Tools the model should prefer in this slice. */
  preferredTools: readonly string[];
  /** Injected into desk focus block when this submodule is active. */
  focusLines: readonly string[];
  /** Default question when member submits bare `/desk submodule`. */
  defaultQuestion: (ticker: string) => string;
};

function q(template: string, ticker: string): string {
  return template.replace(/\{ticker\}/g, ticker);
}

const SPX_SLAYER: DeskSubmoduleDef[] = [
  {
    id: "play",
    label: "Play engine",
    aliases: ["play", "engine", "phase", "action"],
    description: "0DTE play phase, action, grade, and invalidation",
    rank: 10,
    preferredTools: ["get_spx_play", "get_spx_structure", "get_gate_rules"],
    focusLines: [
      "Lead with play engine: phase, action, grade, invalidation.",
      "Use get_spx_play + get_gate_rules — not generic positioning unless gates reference levels.",
    ],
    defaultQuestion: () =>
      "What's the SPX play engine right now — phase, action, grade, and gate status?",
  },
  {
    id: "gex",
    label: "GEX matrix",
    aliases: ["gex", "gamma", "matrix", "walls"],
    description: "Gamma flip, call/put walls, king strike, net GEX",
    rank: 20,
    preferredTools: ["get_gex_heatmap", "get_positioning", "get_spx_structure"],
    focusLines: [
      "Lead with GEX matrix: flip, call wall, put wall, king strike, net GEX regime.",
      "When VEX/vanna is asked, cite vanna posture and charm context from the same matrix read.",
      "Use get_gex_heatmap (SPX 0DTE) — cite exact strike levels.",
    ],
    defaultQuestion: () =>
      "What's the SPX GEX matrix — flip, call wall, put wall, and gamma regime?",
  },
  {
    id: "pulse",
    label: "Pulse rail",
    aliases: ["pulse", "signals", "rail", "events"],
    description: "Live SPX pulse — flip crosses, magnet shifts, macro phases, wall builds",
    rank: 25,
    preferredTools: ["get_spx_pulse", "get_spx_structure", "get_spx_play"],
    focusLines: [
      "Lead with pulse rail events — flip cross, magnet shift, macro phase, wall build/dissolve.",
      "Use get_spx_pulse for structural transitions; cross-check levels with get_spx_structure.",
    ],
    defaultQuestion: () =>
      "What's firing on the SPX pulse rail right now — flip, magnet, macro, and wall events?",
  },
  {
    id: "pin",
    label: "EOD pin",
    aliases: ["pin", "eod-pin", "eod", "magnet"],
    description: "End-of-day pin forecaster — magnet, cone, projected close",
    rank: 30,
    preferredTools: ["get_spx_pin", "get_gex_heatmap", "get_positioning"],
    focusLines: [
      "Lead with EOD pin forecast from get_spx_pin — pin strike, magnet, confidence band, fade vs hold.",
      "Do NOT substitute max pain or walls alone — the desk runs a dedicated pin forecaster.",
    ],
    defaultQuestion: () =>
      "What's the SPX EOD pin setup — magnet strike, projected close, and fade risk into the bell?",
  },
  {
    id: "gates",
    label: "Gate checklist",
    aliases: ["gates", "gate", "checklist", "trace"],
    description: "Every play gate pass/fail with reasons",
    rank: 40,
    preferredTools: ["get_gate_rules", "get_spx_play", "get_spx_confluence"],
    focusLines: [
      "Lead with gate checklist — each gate pass/fail with the live reason.",
      "Use get_gate_rules; do not hand-wave blocked gates.",
    ],
    defaultQuestion: () =>
      "Walk the SPX gate checklist — which gates pass, which fail, and why?",
  },
  {
    id: "lotto",
    label: "Lotto runner",
    aliases: ["lotto", "runner", "multi-dte", "3dte", "weekly"],
    description: "Live SPX lotto runner — multi-day horizon vs 0DTE engine",
    rank: 42,
    preferredTools: ["get_lotto_live", "get_lotto_state", "get_spx_play"],
    focusLines: [
      "Lead with lotto runner state from get_lotto_live — phase, direction, strike, invalidation.",
      "Contrast with the main 0DTE play engine; say honestly if no lotto is active.",
    ],
    defaultQuestion: () =>
      "Is there a live SPX lotto runner — phase, direction, strike, and how it differs from 0DTE?",
  },
  {
    id: "power-hour",
    label: "Power hour",
    aliases: ["power-hour", "powerhour", "ph", "245", "close-play"],
    description: "Power Hour play (2:45–3:15 PM ET) — direction, levels, status",
    rank: 44,
    preferredTools: ["get_power_hour", "get_spx_pin", "get_spx_play"],
    focusLines: [
      "Lead with Power Hour play from get_power_hour — phase, direction, strike, levels.",
      "Cross-check pin forecast into the close when relevant.",
    ],
    defaultQuestion: () =>
      "What's the SPX Power Hour play — phase, direction, strike, and levels into the close?",
  },
  {
    id: "technicals",
    label: "Technicals",
    aliases: ["technicals", "tech", "vwap", "ema", "structure"],
    description: "VWAP, EMA stack, prior session levels, trend",
    rank: 50,
    preferredTools: ["get_spx_structure", "get_spx_pulse", "get_spx_confluence"],
    focusLines: [
      "Lead with technical structure: VWAP, EMA stack, prior session OHLC, trend vs mean.",
      "Cross-reference GEX flip only when it aligns or conflicts with price structure.",
    ],
    defaultQuestion: () =>
      "What's the SPX technical structure — VWAP, EMA stack, and trend vs dealer levels?",
  },
  {
    id: "signal-log",
    label: "Signal log",
    aliases: ["signal-log", "signals-log", "committed", "last-signal"],
    description: "Committed SPX BUY/SELL/TRIM signals from Postgres",
    rank: 52,
    preferredTools: ["get_signal_log", "get_spx_play", "get_open_plays"],
    focusLines: [
      "Lead with committed signal log — last BUY/SELL/TRIM, strike, grade, outcome if graded.",
      "get_signal_log is committed signals only — gate blocks and near-misses are NOT here.",
    ],
    defaultQuestion: () =>
      "What's in the SPX signal log — last committed signals and open play exposure?",
  },
  {
    id: "engine-history",
    label: "Engine history",
    aliases: ["engine-history", "snapshots", "rejection", "scanning", "blocked"],
    description: "SPX engine snapshot log — rejections, scanning, gate blocks over time",
    rank: 54,
    preferredTools: ["get_spx_engine_snapshots", "get_gate_rules", "get_spx_play"],
    focusLines: [
      "Lead with engine snapshots — phase transitions, gate blocks, rejection reasons.",
      "Use get_spx_engine_snapshots for 'why blocked at 10:15' — NOT get_signal_log (committed only).",
    ],
    defaultQuestion: () =>
      "What has the SPX play engine been doing — recent snapshots, blocks, and rejection reasons?",
  },
  {
    id: "record",
    label: "SPX record",
    aliases: ["record", "win-rate", "stats", "graded"],
    description: "SPX Slayer graded stats — win rate, setup breakdown, recent outcomes",
    rank: 56,
    preferredTools: ["get_setup_stats", "get_trade_history", "get_signal_log"],
    focusLines: [
      "Lead with public SPX graded stats — win rate, sample size, setup breakdown.",
      "Cite sample size; never fabricate expectancy on thin data.",
    ],
    defaultQuestion: () =>
      "What's the SPX Slayer track record — win rate, setup stats, and recent graded outcomes?",
  },
  {
    id: "internals",
    label: "Market internals",
    aliases: ["internals", "tick", "trin", "breadth", "add"],
    description: "NYSE TICK/TRIN/ADD and breadth vs SPX play posture",
    rank: 58,
    preferredTools: ["get_spx_structure", "get_spx_pulse", "get_spx_play"],
    focusLines: [
      "Lead with TICK/TRIN/ADD from get_spx_structure — cite whether breadth supports or conflicts with play.",
      "Flag internals_estimated when breadth is proxy-derived, not live NYSE.",
    ],
    defaultQuestion: () =>
      "What are SPX market internals — TICK, TRIN, breadth — and do they support today's play?",
  },
  {
    id: "flow-gex",
    label: "Flow × GEX",
    aliases: ["flow-gex", "flowgex", "confluence", "conflict"],
    description: "HELIX flow vs dealer GEX — agreement or conflict",
    rank: 60,
    preferredTools: ["get_spx_confluence", "get_flow_brief", "get_gex_heatmap", "get_thermal_compare"],
    focusLines: [
      "Lead with flow vs GEX confluence — where HELIX and dealer positioning agree or conflict.",
      "Use get_spx_confluence and get_thermal_compare; name conflicts explicitly.",
    ],
    defaultQuestion: () =>
      "Where do HELIX flow and SPX dealer GEX agree or conflict right now?",
  },
  {
    id: "vector",
    label: "Vector overlay",
    aliases: ["vector", "chart", "beads", "structure-feed"],
    description: "Vector structure overlay on SPX — beads, walls, play card",
    rank: 62,
    preferredTools: ["get_vector_full_state", "get_spx_structure", "get_spx_play"],
    focusLines: [
      "Lead with Vector structure on SPX — beads, walls, play card bias/grade.",
      "Cross-check SPX Slayer play engine when Vector and Slayer disagree.",
    ],
    defaultQuestion: () =>
      "What does Vector show on SPX — structure, beads, walls, and play card vs the Slayer engine?",
  },
];

const HELIX: DeskSubmoduleDef[] = [
  {
    id: "tape",
    label: "Flow tape",
    aliases: ["tape", "flow", "summary"],
    description: "Net premium, bias, and tape summary",
    rank: 10,
    preferredTools: ["get_flow_brief", "get_flow_tape", "get_options_flow"],
    focusLines: ["Lead with net premium, bias, and tape summary for the scoped ticker."],
    defaultQuestion: (t) =>
      t === "SPX"
        ? "Summarize HELIX flow on SPX — net premium, bias, and tape skew."
        : `Summarize HELIX flow on ${t} — net premium, bias, and biggest prints.`,
  },
  {
    id: "whales",
    label: "Whale prints",
    aliases: ["whales", "whale", "prints", "big"],
    description: "Largest premium prints and sweep activity",
    rank: 20,
    preferredTools: ["get_helix_tape_analytics", "get_flow_tape", "get_options_flow"],
    focusLines: ["Lead with the biggest prints — premium, strike, expiry, route."],
    defaultQuestion: (t) => `What are the biggest HELIX whale prints on ${t} right now?`,
  },
  {
    id: "tide",
    label: "Market tide",
    aliases: ["tide", "market-tide", "sentiment"],
    description: "Broad market flow tide and sector skew",
    rank: 30,
    preferredTools: ["get_flow_brief", "get_helix_derived"],
    focusLines: ["Lead with market tide — bullish/bearish skew and sector rotation in flow."],
    defaultQuestion: () => "What's HELIX market tide showing — bullish or bearish skew right now?",
  },
  {
    id: "strike-stack",
    label: "Strike stack",
    aliases: ["strike-stack", "strikes", "stack", "concentration"],
    description: "Strike concentration and premium stacking",
    rank: 40,
    preferredTools: ["get_helix_tape_analytics", "get_options_flow"],
    focusLines: ["Lead with strike concentration — where premium is stacking."],
    defaultQuestion: (t) => `Where is HELIX premium stacking on ${t} — top strike concentrations?`,
  },
  {
    id: "darkpool",
    label: "Dark pool",
    aliases: ["darkpool", "dark", "dp", "block"],
    description: "Dark pool and block print activity",
    rank: 50,
    preferredTools: ["get_flow_tape", "get_postgres_flows"],
    focusLines: ["Lead with dark pool / block activity — size, side, and timing."],
    defaultQuestion: (t) => `Any notable dark pool or block flow on ${t} in HELIX?`,
  },
  {
    id: "analytics",
    label: "Derived analytics",
    aliases: ["analytics", "derived", "stats"],
    description: "HELIX derived metrics — skew, velocity, anomalies",
    rank: 60,
    preferredTools: ["get_helix_derived", "get_helix_tape_analytics"],
    focusLines: ["Lead with derived HELIX analytics — skew velocity and anomalies."],
    defaultQuestion: (t) => `What do HELIX derived analytics show for ${t}?`,
  },
];

const THERMAL: DeskSubmoduleDef[] = [
  {
    id: "positioning",
    label: "Positioning",
    aliases: ["positioning", "pos", "levels"],
    description: "Flip, walls, net GEX regime",
    rank: 10,
    preferredTools: ["get_positioning", "get_gex"],
    focusLines: ["Lead with flip, call/put walls, net GEX — dealer positioning summary."],
    defaultQuestion: (t) => `What's Thermal positioning for ${t} — flip, walls, gamma regime?`,
  },
  {
    id: "matrix",
    label: "Full matrix",
    aliases: ["matrix", "heatmap", "grid"],
    description: "Full GEX heatmap matrix by strike and expiry",
    rank: 20,
    preferredTools: ["get_gex_heatmap", "get_gex_matrix_changes"],
    focusLines: ["Lead with matrix highlights — king strike, hot strikes, expiry concentration."],
    defaultQuestion: (t) => `Walk the Thermal GEX matrix for ${t} — king strike and hot zones.`,
  },
  {
    id: "changes",
    label: "Matrix shifts",
    aliases: ["changes", "shifts", "delta", "drift"],
    description: "Intraday matrix changes and GEX drift",
    rank: 30,
    preferredTools: ["get_gex_matrix_changes", "get_gex_heatmap"],
    focusLines: ["Lead with what shifted in the matrix since open — flip drift, wall migration."],
    defaultQuestion: (t) => `What shifted in the Thermal matrix for ${t} since the open?`,
  },
  {
    id: "compare",
    label: "Compare tickers",
    aliases: ["compare", "mag7", "mega", "cross"],
    description: "Side-by-side positioning across tickers",
    rank: 40,
    preferredTools: ["get_positioning", "get_gex_heatmap"],
    focusLines: ["Lead with cross-ticker compare — flip/walls/regime side by side."],
    defaultQuestion: () => "Compare Thermal positioning across Mag7 — flip, walls, and gamma regime.",
  },
  {
    id: "vex",
    label: "VEX lens",
    aliases: ["vex", "vanna", "charm"],
    description: "VEX/vanna regime and charm decay",
    rank: 50,
    preferredTools: ["get_gex_heatmap", "get_positioning"],
    focusLines: ["Lead with VEX/vanna lens — regime and charm decay into close."],
    defaultQuestion: (t) => `What's the VEX/vanna read on ${t} in Thermal right now?`,
  },
];

const VECTOR: DeskSubmoduleDef[] = [
  {
    id: "structure",
    label: "Structure",
    aliases: ["structure", "levels", "walls"],
    description: "Gamma flip, walls, beads, key levels",
    rank: 10,
    preferredTools: ["get_vector_full_state", "get_positioning"],
    focusLines: ["Lead with Vector structure — flip, walls, beads, key levels."],
    defaultQuestion: (t) => `What's Vector structure on ${t} — flip, walls, and key levels?`,
  },
  {
    id: "play",
    label: "Play card",
    aliases: ["play", "card", "bias", "grade"],
    description: "Vector play card bias, grade, and setup",
    rank: 20,
    preferredTools: ["get_vector_full_state", "get_vector_analytics"],
    focusLines: ["Lead with play card — bias, grade, entry context."],
    defaultQuestion: (t) => `What's the Vector play card on ${t} — bias, grade, setup?`,
  },
  {
    id: "regime",
    label: "Regime",
    aliases: ["regime", "posture", "trend"],
    description: "Market regime posture and trend state",
    rank: 30,
    preferredTools: ["get_vector_analytics", "get_vector_full_state"],
    focusLines: ["Lead with regime posture — trend, volatility, dealer alignment."],
    defaultQuestion: (t) => `What's Vector regime posture on ${t}?`,
  },
  {
    id: "chart",
    label: "Chart levels",
    aliases: ["chart", "levels", "pivots"],
    description: "Chart pivots, support/resistance from Vector",
    rank: 40,
    preferredTools: ["get_vector_full_state"],
    focusLines: ["Lead with chart levels — pivots, support, resistance from live Vector state."],
    defaultQuestion: (t) => `What chart levels is Vector flagging on ${t}?`,
  },
];

const NIGHTHAWK: DeskSubmoduleDef[] = [
  {
    id: "board",
    label: "Board",
    aliases: ["board", "plays", "open"],
    description: "Open 0DTE plays, status, and count",
    rank: 10,
    preferredTools: ["get_zerodte_plays", "get_open_plays"],
    focusLines: ["Lead with open board — tickers, status, discovery vs committed."],
    defaultQuestion: () => "What's on the Night Hawk board — open plays and status?",
  },
  {
    id: "marks",
    label: "Marks & P&L",
    aliases: ["marks", "pnl", "p&l", "profit"],
    description: "Live marks, P&L%, stopped positions",
    rank: 20,
    preferredTools: ["get_zerodte_plays", "get_open_plays"],
    focusLines: ["Lead with marks and P&L — best/worst, stopped, time-stop candidates."],
    defaultQuestion: () => "What's the Night Hawk board P&L — marks, winners, and stopped positions?",
  },
  {
    id: "discovery",
    label: "Discovery",
    aliases: ["discovery", "scan", "funnel", "candidates"],
    description: "Discovery funnel — flow, breakout, pin candidates",
    rank: 30,
    preferredTools: ["get_zerodte_plays", "get_nighthawk_edition"],
    focusLines: ["Lead with discovery funnel — which rails fired, governor/heat gates."],
    defaultQuestion: () => "What's Night Hawk discovery showing — candidates and gate reasons?",
  },
  {
    id: "condor",
    label: "Iron condor",
    aliases: ["condor", "iron", "premium"],
    description: "Iron condor geometry, credit, breach status",
    rank: 40,
    preferredTools: ["get_zerodte_plays", "get_open_plays"],
    focusLines: ["Lead with condor legs — short/long strikes, net credit, breach vs inside."],
    defaultQuestion: () => "How are Night Hawk iron condors tracking — credit, wings, breach?",
  },
];

const MERIDIAN: DeskSubmoduleDef[] = [
  {
    id: "calendar",
    label: "Calendar",
    aliases: ["calendar", "today", "events"],
    description: "Today's catalyst calendar and timing",
    rank: 10,
    preferredTools: ["get_catalysts", "get_earnings"],
    focusLines: ["Lead with today's calendar — events, timing, impact tickers."],
    defaultQuestion: () => "What's on the Meridian calendar today — events and timing?",
  },
  {
    id: "earnings",
    label: "Earnings",
    aliases: ["earnings", "eps", "reports"],
    description: "Earnings reports, expected move, reactions",
    rank: 20,
    preferredTools: ["get_earnings", "get_catalysts"],
    focusLines: ["Lead with earnings — reporting names, expected move, pre/post setup."],
    defaultQuestion: (t) =>
      t === "SPX"
        ? "What earnings are on Meridian today — expected moves and timing?"
        : `What's the Meridian earnings setup for ${t}?`,
  },
  {
    id: "catalysts",
    label: "Catalysts",
    aliases: ["catalysts", "fda", "macro", "guidance"],
    description: "FDA, M&A, guidance, macro catalysts",
    rank: 30,
    preferredTools: ["get_catalysts", "get_news"],
    focusLines: ["Lead with catalysts — FDA, M&A, guidance, macro with ticker impact."],
    defaultQuestion: (t) =>
      t === "SPX"
        ? "What macro and stock catalysts are on Meridian today?"
        : `What catalysts does Meridian flag for ${t}?`,
  },
  {
    id: "news",
    label: "News feed",
    aliases: ["news", "headlines", "feed"],
    description: "Live news headlines with desk relevance",
    rank: 40,
    preferredTools: ["get_news", "get_catalysts"],
    focusLines: ["Lead with actionable news — headline, timing, ticker impact."],
    defaultQuestion: (t) =>
      t === "SPX"
        ? "What market-moving news is Meridian showing right now?"
        : `Latest Meridian news on ${t}?`,
  },
];

const LARGO_PLATFORM: DeskSubmoduleDef[] = [
  {
    id: "trinity",
    label: "Trinity read",
    aliases: ["trinity", "indices", "spx-spy-qqq"],
    description: "SPX · SPY · QQQ structure and flow side by side",
    rank: 10,
    preferredTools: ["get_spx_structure", "get_positioning", "get_flow_brief"],
    focusLines: ["Compare SPX, SPY, QQQ — structure, flow skew, dealer positioning side by side."],
    defaultQuestion: () =>
      "Compare SPX, SPY, and QQQ — structure, flow skew, and dealer positioning side by side.",
  },
  {
    id: "conflict",
    label: "System conflict",
    aliases: ["conflict", "disagree", "diverge"],
    description: "Where desks disagree — flow vs GEX vs play engine",
    rank: 20,
    preferredTools: ["blackout_intelligence", "get_spx_confluence"],
    focusLines: ["Name explicit conflicts between HELIX, Thermal, and play engine — do not smooth over."],
    defaultQuestion: () => "Where do HELIX flow, Thermal GEX, and the SPX play engine disagree?",
  },
  {
    id: "brief",
    label: "Morning brief",
    aliases: ["brief", "morning", "open"],
    description: "Cross-desk morning brief — what matters at the open",
    rank: 30,
    preferredTools: ["blackout_intelligence"],
    focusLines: ["Synthesize cross-desk morning brief — levels, flow, catalysts, board state."],
    defaultQuestion: () => "Give me the cross-desk morning brief — what matters at the open?",
  },
  {
    id: "watchlist",
    label: "Watchlist",
    aliases: ["watchlist", "watch", "wl"],
    description: "Summarize member watchlist tickers",
    rank: 40,
    preferredTools: ["blackout_intelligence", "get_positioning", "get_flow_brief"],
    focusLines: ["Summarize each watchlist ticker — structure, flow, catalyst if any."],
    defaultQuestion: () => "Summarize what matters on my watchlist right now.",
  },
];

const TRACK_RECORD: DeskSubmoduleDef[] = [
  {
    id: "stats",
    label: "Win rate stats",
    aliases: ["stats", "winrate", "wr", "record"],
    description: "Graded win rate, expectancy, setup breakdown",
    rank: 10,
    preferredTools: ["get_setup_stats", "get_signal_log"],
    focusLines: ["Lead with public graded stats — win rate, sample size, setup breakdown."],
    defaultQuestion: () => "What's the track record win rate and setup stats?",
  },
  {
    id: "recent",
    label: "Recent graded",
    aliases: ["recent", "latest", "last"],
    description: "Most recent graded outcomes",
    rank: 20,
    preferredTools: ["get_signal_log", "get_trade_history"],
    focusLines: ["Lead with most recent graded outcomes — ticker, setup, result."],
    defaultQuestion: () => "What are the most recent graded track record outcomes?",
  },
  {
    id: "setup",
    label: "Setup breakdown",
    aliases: ["setup", "breakdown", "by-setup"],
    description: "Performance by setup type",
    rank: 30,
    preferredTools: ["get_setup_stats"],
    focusLines: ["Break down performance by setup type — sample size matters, cite it."],
    defaultQuestion: () => "Break down track record performance by setup type.",
  },
];

export const DESK_SUBMODULES: Partial<Record<DeskScopeKey, readonly DeskSubmoduleDef[]>> = {
  "spx-slayer": SPX_SLAYER,
  helix: HELIX,
  thermal: THERMAL,
  vector: VECTOR,
  nighthawk: NIGHTHAWK,
  meridian: MERIDIAN,
  largo: LARGO_PLATFORM,
  "track-record": TRACK_RECORD,
};

/** Client-safe payload shape for the Modules tab. */
export type SlashSubmoduleItem = {
  id: string;
  label: string;
  description: string;
  rank: number;
  /** Example question shown on hover / chip. */
  exampleQuestion: string;
};

export function submodulesForDesk(desk: string | null | undefined): readonly DeskSubmoduleDef[] {
  if (!desk) return [];
  const key = desk.trim().toLowerCase() as DeskScopeKey;
  return DESK_SUBMODULES[key] ?? [];
}

export function resolveSubmodule(
  desk: string | null | undefined,
  token: string | null | undefined
): DeskSubmoduleDef | null {
  if (!desk || !token) return null;
  const t = token.trim().toLowerCase();
  if (!t) return null;
  for (const mod of submodulesForDesk(desk)) {
    if (mod.id === t || mod.aliases.some((a) => a.toLowerCase() === t)) {
      return mod;
    }
  }
  return null;
}

/** Strip submodule token from args tail; returns submodule id + remainder. */
export function peelSubmoduleFromArgs(
  desk: string | null | undefined,
  args: string
): { submodule: DeskSubmoduleDef | null; rest: string } {
  const raw = args.trim();
  if (!raw || !desk) return { submodule: null, rest: raw };

  const parts = raw.split(/\s+/);
  const first = (parts[0] ?? "").replace(/^\//, "");
  const mod = resolveSubmodule(desk, first);
  if (!mod) return { submodule: null, rest: raw };

  const rest = parts.slice(1).join(" ").trim();
  return { submodule: mod, rest };
}

export function submoduleItemsForDesk(
  desk: string,
  defaultTicker = "SPX"
): SlashSubmoduleItem[] {
  return submodulesForDesk(desk).map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    rank: m.rank,
    exampleQuestion: m.defaultQuestion(defaultTicker),
  }));
}

export function formatSubmoduleFocusBlock(
  desk: string | null | undefined,
  submoduleId: string | null | undefined,
  ticker = "SPX"
): string {
  const mod = resolveSubmodule(desk, submoduleId ?? "");
  if (!mod) return "";
  const lines = [
    `\n### Submodule: ${mod.label}`,
    ...mod.focusLines.map((l) => `- ${l}`),
    `- Preferred tools: ${mod.preferredTools.join(", ")}.`,
    `- Default lens question: "${mod.defaultQuestion(ticker)}"`,
  ];
  return lines.join("\n") + "\n";
}

export function submoduleDefaultQuestion(
  desk: string | null | undefined,
  submoduleId: string | null | undefined,
  ticker = "SPX"
): string | null {
  const mod = resolveSubmodule(desk, submoduleId ?? "");
  if (!mod) return null;
  return mod.defaultQuestion(ticker);
}

/** Filter stable modules as member types after `/desk mod…`. */
export function filterSubmodules(
  modules: SlashSubmoduleItem[],
  query: string
): SlashSubmoduleItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return modules;
  return modules.filter(
    (m) =>
      m.id.includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
  );
}
