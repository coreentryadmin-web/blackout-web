/**
 * Desk scope — when a member selects /spx-slayer, /helix, etc., Largo must behave as if
 * it is sitting ON that desk: right tools, right prefetch, right mini-panel, right voice.
 */

import type { LargoProduct } from "@/lib/largo/registry/capability-registry";
import type { LargoQuestionIntent } from "@/lib/largo/question-intent";
import { looksLikeMemberTicker } from "@/lib/largo/question-intent";
import {
  formatSubmoduleFocusBlock,
  peelSubmoduleFromArgs,
  resolveSubmodule,
} from "@/lib/largo/slash-submodules";

export type DeskScopeKey =
  | "spx-slayer"
  | "helix"
  | "thermal"
  | "vector"
  | "meridian"
  | "nighthawk"
  | "largo"
  | "track-record";

export type DeskMiniPanelKind =
  | "spx"
  | "helix"
  | "thermal"
  | "vector"
  | "nighthawk"
  | "meridian"
  | "generic";

export type DeskScopeConfig = {
  key: DeskScopeKey;
  label: string;
  href: string;
  defaultTicker: string;
  product: LargoProduct;
  miniPanel: DeskMiniPanelKind;
  preferredTools: readonly string[];
  focusBlock: string;
};

const DESK_CONFIG: Record<DeskScopeKey, DeskScopeConfig> = {
  "spx-slayer": {
    key: "spx-slayer",
    label: "SPX Slayer",
    href: "/dashboard",
    defaultTicker: "SPX",
    product: "SPX_SLAYER",
    miniPanel: "spx",
    preferredTools: [
      "get_spx_structure",
      "get_spx_play",
      "get_spx_confluence",
      "get_gex_heatmap",
      "get_positioning",
      "get_spx_pulse",
      "get_spx_pin",
      "get_gate_rules",
      "get_lotto_live",
      "get_power_hour",
      "get_signal_log",
      "get_spx_engine_snapshots",
      "get_open_plays",
      "get_vector_full_state",
      "get_setup_stats",
    ],
    focusBlock: `## Active desk scope: SPX Slayer
The member invoked **SPX Slayer** (/dashboard). You are their SPX 0DTE desk analyst — NOT a generic chatbot.
- Lead with: play engine phase/action/grade, GEX matrix (flip, walls, king strike), gate checklist, confluence.
- Tools: get_spx_structure, get_spx_play, get_spx_confluence, get_gex_heatmap (SPX), get_spx_pulse, get_spx_pin, get_gate_rules, get_lotto_live, get_power_hour, get_signal_log, get_spx_engine_snapshots.
- **Pulse rail:** get_spx_pulse for flip crosses, magnet shifts, macro phases, wall builds.
- **Pin forecast:** get_spx_pin for EOD pin cone — NOT max pain alone.
- **Engine history:** get_spx_engine_snapshots for gate blocks/rejections; get_signal_log for committed signals only.
- **Internals:** TICK/TRIN/ADD live on get_spx_structure — cite breadth vs play posture.
- **Macro/events:** Live feed carries Macro calendar (FOMC/CPI/NFP) from the desk — cite scheduled events and how gates/play posture should change; call get_economic_calendar when the calendar is thin.
- **Best play** questions: answer from get_spx_play (phase/action/grade) + get_gate_rules — one verdict, not generic advice.
- **3DTE/7DTE/weekly:** Primary engine is 0DTE; for multi-day horizons use get_lotto_live (lotto runner) or get_option_chain at the requested expiry — say honestly if no committed multi-DTE play exists. Never refuse with "couldn't pull data" when lotto_live or spx_structure is in the live feed.
- **VEX/vanna:** When asked, cite vanna posture from get_gex_heatmap / get_positioning alongside gamma flip and walls.
- **Vector overlay:** get_vector_full_state(SPX) when chart structure or beads conflict with play engine.
- Do NOT send them to Night Hawk for SPX engine state — that is a different product.
- Every number must come from tools; cite flip/walls/phase explicitly.`,
  },
  helix: {
    key: "helix",
    label: "HELIX",
    href: "/flows",
    defaultTicker: "SPX",
    product: "HELIX",
    miniPanel: "helix",
    preferredTools: [
      "get_flow_tape",
      "get_flow_brief",
      "get_helix_tape_analytics",
      "get_helix_derived",
      "get_options_flow",
      "get_postgres_flows",
    ],
    focusBlock: `## Active desk scope: HELIX
The member invoked **HELIX** (/flows). You are their flow-tape analyst.
- Lead with: net premium skew, biggest prints, route breakdown, strike stacks, whale count, tide.
- Tools: get_flow_brief, get_helix_tape_analytics, get_helix_derived, get_flow_tape, get_options_flow.
- Validate flow numbers — deep ITM stock-replacement prints can invert net premium.`,
  },
  thermal: {
    key: "thermal",
    label: "BlackOut Thermal",
    href: "/heatmap",
    defaultTicker: "SPX",
    product: "THERMAL",
    miniPanel: "thermal",
    preferredTools: ["get_positioning", "get_gex_heatmap", "get_gex_matrix_changes", "get_gex"],
    focusBlock: `## Active desk scope: Thermal
The member invoked **BlackOut Thermal** (/heatmap). You are their dealer positioning analyst.
- Lead with: gamma flip, call/put walls, net GEX/VEX regime, king strike, matrix shifts.
- Tools: get_positioning, get_gex_heatmap, get_gex_matrix_changes.
- Compare to HELIX flow only when the member asks or systems conflict.`,
  },
  vector: {
    key: "vector",
    label: "Vector",
    href: "/vector",
    defaultTicker: "SPX",
    product: "VECTOR",
    miniPanel: "vector",
    preferredTools: ["get_vector_full_state", "get_vector_analytics", "get_positioning"],
    focusBlock: `## Active desk scope: Vector
The member invoked **Vector** (/vector). You are their chart + structure analyst.
- Lead with: spot, beads, walls, gamma flip, play card bias/grade, regime.
- Tools: get_vector_full_state, get_vector_analytics, get_positioning for GEX overlays.`,
  },
  meridian: {
    key: "meridian",
    label: "Meridian",
    href: "/meridian",
    defaultTicker: "SPX",
    product: "CATALYSTS",
    miniPanel: "meridian",
    preferredTools: ["get_catalysts", "get_earnings", "get_news"],
    focusBlock: `## Active desk scope: Meridian
The member invoked **Meridian** (/meridian). You are their catalyst + earnings desk analyst.
- Lead with: today's calendar, earnings expected move, macro events, ticker-specific intel.
- Tools: catalyst/earnings/news tools; cross-reference HELIX/Thermal when relevant.`,
  },
  nighthawk: {
    key: "nighthawk",
    label: "Night Hawk",
    href: "/nighthawk",
    defaultTicker: "SPX",
    product: "NIGHT_HAWK",
    miniPanel: "nighthawk",
    preferredTools: ["get_zerodte_plays", "get_open_plays", "get_nighthawk_edition"],
    focusBlock: `## Active desk scope: Night Hawk
The member invoked **Night Hawk** (/nighthawk). You are their 0DTE board analyst.
- Lead with: open plays, marks, P&L, stopped positions, discovery/commit status.
- Tools: get_zerodte_plays, get_open_plays — NOT SPX Slayer play engine for multi-ticker board.`,
  },
  largo: {
    key: "largo",
    label: "Largo",
    href: "/terminal",
    defaultTicker: "SPX",
    product: "PLATFORM",
    miniPanel: "generic",
    preferredTools: ["blackout_intelligence"],
    focusBlock: `## Active desk scope: Full platform
The member wants a cross-desk read. Synthesize SPX Slayer, HELIX, Thermal, Vector, Night Hawk as needed.
- State which desk each number came from when they disagree.`,
  },
  "track-record": {
    key: "track-record",
    label: "Track Record",
    href: "/track-record",
    defaultTicker: "SPX",
    product: "TRACK_RECORD",
    miniPanel: "generic",
    preferredTools: ["get_signal_log", "get_setup_stats", "get_trade_history"],
    focusBlock: `## Active desk scope: Track Record
The member invoked **Track Record**. Lead with graded outcomes, win rate, setup stats — public record only.`,
  },
};

export function deskScopeConfig(key: string | null | undefined): DeskScopeConfig | null {
  if (!key) return null;
  const k = key.trim().toLowerCase() as DeskScopeKey;
  return DESK_CONFIG[k] ?? null;
}

export type DeskSlashArgs = {
  /** Stable submodule id from slash-submodules registry (e.g. gex, whales, board). */
  submodule?: string;
  ticker?: string;
  mode?: "compare-mag7" | "gate-trace" | "trinity" | "board" | "diff" | "watch";
  watchTickers?: string[];
};

export function formatDeskScopeBlock(key: string | null | undefined, args?: DeskSlashArgs): string {
  const cfg = deskScopeConfig(key);
  if (!cfg) return "";
  const ticker = args?.ticker ?? cfg.defaultTicker;
  let block = cfg.focusBlock;
  if (args?.submodule) {
    const mod = resolveSubmodule(key, args.submodule);
    if (mod) {
      block += formatSubmoduleFocusBlock(key, mod.id, ticker);
    }
  }
  if (args?.mode === "compare-mag7") {
    block += `\n- Member asked for **Mag7 Thermal compare** — use get_positioning / compare grid for mega-cap names.`;
  } else if (args?.mode === "gate-trace") {
    block += `\n- Member asked for **gate trace** — use get_gate_rules and explain each gate pass/fail.`;
  } else if (args?.mode === "trinity") {
    block += `\n- Member asked for **Trinity read** (SPX, SPY, QQQ side by side) — compare structure and flow across all three.`;
  }
  if (ticker && ticker !== cfg.defaultTicker) {
    block += `\n- Scoped ticker: **${ticker}** (override default ${cfg.defaultTicker}).`;
  }
  block += formatScopedAnswerContract(args);
  return `\n\n${block}\n`;
}

/** Talon-style scoped turn — answer the exact question, not a desk tour. */
export function formatScopedAnswerContract(args?: DeskSlashArgs): string {
  const lens = args?.submodule
    ? `Submodule **${args.submodule}** is a lens — not a mandate to dump every tool.`
    : `Desk scope is set — stay on-desk but answer the member's exact words.`;
  return `
## Scoped answer contract
- ${lens}
- **Lead with a one-line verdict** that directly answers what they asked, then evidence.
- Cite exact numbers from tools (spot, flip, walls, net flow) — no ranges unless the data is a range.
- If they scoped desk-only and asked a narrow question, stay narrow; do not auto-survey all submodules.
- When the read is unclear or conflicting, say **wait** — do not invent a trade or grade.
- Follow-up chips should be strike-level questions grounded in what you just cited.
`;
}

const TICKER_TOKEN = /^\$?([A-Z][A-Z0-9]{0,4})$/i;

/** Parse tail after slash command: `/helix /whales NVDA`, `/spx-slayer /gex`, `/thermal compare mag7`. */
export function parseDeskSlashArgs(args: string, desk?: string | null): DeskSlashArgs {
  const raw = args.trim();
  if (!raw) return {};

  // Multi-word terminal modes — must run before submodule peel ("gate trace" ≠ gates + TRACE).
  if (/^compare\s+(mag7|mag\s*7|mega)/i.test(raw)) {
    const out: DeskSlashArgs = { mode: "compare-mag7" };
    if (desk === "thermal") out.submodule = "compare";
    return out;
  }
  if (/^gate\s*trace/i.test(raw)) {
    const out: DeskSlashArgs = { mode: "gate-trace" };
    if (desk) out.submodule = "gates";
    return out;
  }
  if (/^trinity/i.test(raw) || /^spx\s+spy\s+qqq/i.test(raw)) {
    const out: DeskSlashArgs = { mode: "trinity", ticker: "SPX" };
    if (desk === "largo") out.submodule = "trinity";
    return out;
  }
  if (/^board/i.test(raw)) {
    const out: DeskSlashArgs = { mode: "board" };
    if (desk === "nighthawk") out.submodule = "board";
    return out;
  }
  if (/^diff/i.test(raw)) {
    return { mode: "diff" };
  }
  if (/^watch/i.test(raw)) {
    const rest = raw.replace(/^watch\s*/i, "");
    const tickers = rest
      .split(/[\s,]+/)
      .map((t) => t.replace(/^\$/, "").toUpperCase())
      .filter((t) => TICKER_TOKEN.test(t));
    const out: DeskSlashArgs = { mode: "watch", watchTickers: tickers };
    if (desk === "largo") out.submodule = "watchlist";
    return out;
  }

  // Peel stable submodule when desk is known: `/spx-slayer /gex`, `/helix /whales NVDA`.
  let tail = raw;
  let submodule: string | undefined;
  if (desk) {
    const peeled = peelSubmoduleFromArgs(desk, raw);
    if (peeled.submodule) {
      submodule = peeled.submodule.id;
      tail = peeled.rest;
    }
  }
  if (!tail && submodule) {
    return { submodule };
  }
  if (!tail) return submodule ? { submodule } : {};

  // The first token is only a ticker if the MEMBER wrote it as one.
  //
  // This used to be a bare `TICKER_TOKEN.test(first)` — case-insensitive, no stopword list — so a
  // scoped desk turned the opening word of any ordinary question into its ticker: "how is SPX
  // looking" -> HOW, "what is a good play?" -> WHAT, "is the system aligned?" -> IS. That ticker
  // then drove the prefetch, the mini-panel and the follow-up chips, so a member asking about SPX
  // got a session pinned to a symbol that does not exist.
  //
  // `looksLikeMemberTicker` is the SAME predicate question-intent.ts uses for free-text questions,
  // reused rather than reimplemented — the duplicate-and-drift is what produced this bug.
  const first = tail.split(/\s+/)[0] ?? "";
  if (looksLikeMemberTicker(first, tail)) {
    const ticker = first.replace(/^\$/, "").toUpperCase();
    return submodule ? { submodule, ticker } : { ticker };
  }

  return submodule ? { submodule } : {};
}

/** Bias question-intent when desk scope is active. */
export function intentOverridesForDeskScope(
  key: string | null | undefined,
  base: LargoQuestionIntent,
  args?: DeskSlashArgs | null
): LargoQuestionIntent {
  const cfg = deskScopeConfig(key);
  if (!cfg) return base;
  const next = { ...base };
  switch (cfg.key) {
    case "spx-slayer":
      next.needsSpxDesk = true;
      next.needsPlayState = true;
      next.needsSpxEngineState = true;
      // Economic calendar on every SPX desk turn — FOMC/CPI awareness even when the
      // member asks "what do you think of SPX today?" without naming the event.
      next.needsNews = true;
      next.tickerHint = next.tickerHint ?? "SPX";
      break;
    case "helix":
      next.needsFlow = true;
      next.needsHelixRead = true;
      break;
    case "thermal":
      next.needsThermalRead = true;
      break;
    case "vector":
      next.needsVectorRead = true;
      break;
    case "nighthawk":
      next.needsZeroDteCommand = true;
      break;
    case "meridian":
      next.needsNews = true;
      break;
    case "track-record":
      next.needsRecordRead = true;
      break;
    default:
      next.needsPlatformRead = true;
  }
  const sub = args?.submodule ? resolveSubmodule(key, args.submodule) : null;
  if (sub) {
    if (sub.id === "play" || sub.id === "gates") {
      next.needsPlayState = true;
      next.needsSpxEngineState = true;
    }
    if (sub.id === "lotto" || sub.id === "power-hour") {
      next.needsPlayState = true;
    }
    if (sub.id === "engine-history") {
      next.needsSpxEngineState = true;
    }
    if (sub.id === "signal-log" || sub.id === "record") {
      next.needsRecordRead = true;
    }
    if (sub.id === "vector") {
      next.needsVectorRead = true;
    }
    if (sub.id === "pulse" || sub.id === "internals") {
      next.needsSpxDesk = true;
    }
    if (sub.id === "gex" || sub.id === "pin" || sub.id === "matrix" || sub.id === "positioning" || sub.id === "vex") {
      next.needsThermalRead = true;
    }
    if (sub.id === "tape" || sub.id === "whales" || sub.id === "tide" || sub.id === "flow-gex") {
      next.needsFlow = true;
      next.needsHelixRead = true;
    }
    if (sub.id === "board" || sub.id === "marks" || sub.id === "discovery" || sub.id === "condor") {
      next.needsZeroDteCommand = true;
    }
    if (sub.id === "trinity" || sub.id === "conflict") {
      next.needsPlatformRead = true;
    }
    if (sub.id === "stats" || sub.id === "recent" || sub.id === "setup") {
      next.needsRecordRead = true;
    }
  }
  if (!next.tickerHint && cfg.defaultTicker) {
    next.tickerHint = cfg.defaultTicker;
  }
  return next;
}

export type TurnSnapshot = {
  as_of: string;
  ticker: string;
  desk_scope?: string | null;
  spot: number | null;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  net_premium: number | null;
  /** The ET SESSION this snapshot was taken in. */
  session_date?: string | null;
  /** WHICH GEX matrix the positioning levels came from — see formatDiffBlock. */
  matrix_asof?: string | null;
};

export function formatDiffBlock(prev: TurnSnapshot | null | undefined, now: TurnSnapshot): string {
  if (!prev) {
    return `\n\n## Session diff\nNo prior snapshot in this thread — report current state only.\n`;
  }
  // SAME-MATRIX GUARD.
  //
  // The positioning levels come from a CACHED GEX matrix. Two turns 90 seconds apart routinely
  // read the SAME matrix, so `prior` and `now` are byte-identical by construction — yet this
  // block announces a real time interval and then instructs "Describe what CHANGED". Asked to
  // describe a change that does not exist, a model invents one. Naming the shared matrix removes
  // the premise instead of hoping the model notices the numbers match.
  const sameMatrix =
    prev.matrix_asof != null && now.matrix_asof != null && prev.matrix_asof === now.matrix_asof;

  const lines = [
    `\n\n## Session diff (since last turn @ ${prev.as_of})`,
    `Prior: spot ${prev.spot ?? "—"}, flip ${prev.flip ?? "—"}, call wall ${prev.call_wall ?? "—"}, put wall ${prev.put_wall ?? "—"}, net flow ${prev.net_premium ?? "—"}`,
    `Now: spot ${now.spot ?? "—"}, flip ${now.flip ?? "—"}, call wall ${now.call_wall ?? "—"}, put wall ${now.put_wall ?? "—"}, net flow ${now.net_premium ?? "—"}`,
  ];
  if (sameMatrix) {
    lines.push(
      "NOTE: both turns read the SAME dealer-positioning matrix, so spot / flip / walls CANNOT " +
        "have changed between them — only the flow tape can differ. Do not describe a move in " +
        "those levels; say the positioning is unchanged since the last turn."
    );
  } else {
    lines.push("Describe what CHANGED — do not restate unchanged levels unless they matter.");
  }
  return lines.join("\n") + "\n";
}
