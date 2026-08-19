/**
 * Desk scope — when a member selects /spx-slayer, /helix, etc., Largo must behave as if
 * it is sitting ON that desk: right tools, right prefetch, right mini-panel, right voice.
 */

import type { LargoProduct } from "@/lib/largo/registry/capability-registry";
import type { LargoQuestionIntent } from "@/lib/largo/question-intent";

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
      "get_gate_rules",
    ],
    focusBlock: `## Active desk scope: SPX Slayer
The member invoked **SPX Slayer** (/dashboard). You are their SPX 0DTE desk analyst — NOT a generic chatbot.
- Lead with: play engine phase/action/grade, GEX matrix (flip, walls, king strike), gate checklist, confluence.
- Tools: get_spx_structure, get_spx_play, get_spx_confluence, get_gex_heatmap (SPX), get_spx_pulse, get_gate_rules.
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
  ticker?: string;
  mode?: "compare-mag7" | "gate-trace" | "trinity" | "board" | "diff" | "watch";
  watchTickers?: string[];
};

export function formatDeskScopeBlock(key: string | null | undefined, args?: DeskSlashArgs): string {
  const cfg = deskScopeConfig(key);
  if (!cfg) return "";
  const ticker = args?.ticker ?? cfg.defaultTicker;
  let block = cfg.focusBlock;
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
  return `\n\n${block}\n`;
}

const TICKER_TOKEN = /^\$?([A-Z][A-Z0-9]{0,4})$/i;

/** Parse tail after slash command: `/helix NVDA`, `/thermal compare mag7`, `/spx gate trace`. */
export function parseDeskSlashArgs(args: string): DeskSlashArgs {
  const raw = args.trim();
  if (!raw) return {};

  if (/^compare\s+(mag7|mag\s*7|mega)/i.test(raw)) {
    return { mode: "compare-mag7" };
  }
  if (/^gate\s*trace/i.test(raw)) {
    return { mode: "gate-trace" };
  }
  if (/^trinity/i.test(raw) || /^spx\s+spy\s+qqq/i.test(raw)) {
    return { mode: "trinity", ticker: "SPX" };
  }
  if (/^board/i.test(raw)) {
    return { mode: "board" };
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
    return { mode: "watch", watchTickers: tickers };
  }

  const first = raw.split(/\s+/)[0] ?? "";
  if (TICKER_TOKEN.test(first)) {
    return { ticker: first.replace(/^\$/, "").toUpperCase() };
  }
  return {};
}

/** Bias question-intent when desk scope is active. */
export function intentOverridesForDeskScope(
  key: string | null | undefined,
  base: LargoQuestionIntent
): LargoQuestionIntent {
  const cfg = deskScopeConfig(key);
  if (!cfg) return base;
  const next = { ...base };
  switch (cfg.key) {
    case "spx-slayer":
      next.needsSpxDesk = true;
      next.needsPlayState = true;
      next.needsSpxEngineState = true;
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
};

export function formatDiffBlock(prev: TurnSnapshot | null | undefined, now: TurnSnapshot): string {
  if (!prev) {
    return `\n\n## Session diff\nNo prior snapshot in this thread — report current state only.\n`;
  }
  const lines = [
    `\n\n## Session diff (since last turn @ ${prev.as_of})`,
    `Prior: spot ${prev.spot ?? "—"}, flip ${prev.flip ?? "—"}, call wall ${prev.call_wall ?? "—"}, put wall ${prev.put_wall ?? "—"}, net flow ${prev.net_premium ?? "—"}`,
    `Now: spot ${now.spot ?? "—"}, flip ${now.flip ?? "—"}, call wall ${now.call_wall ?? "—"}, put wall ${now.put_wall ?? "—"}, net flow ${now.net_premium ?? "—"}`,
    "Describe what CHANGED — do not restate unchanged levels unless they matter.",
  ];
  return lines.join("\n") + "\n";
}
