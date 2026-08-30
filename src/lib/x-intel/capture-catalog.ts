/**
 * VISUAL CAPTURE CATALOG — machine-readable scout map for every BLACKOUT surface.
 *
 * Product → page → tab → panel → interaction → screenshot state.
 * Linked to `view-catalog.ts` (editorial framing) and executed by
 * `scripts/audit/lib/x-capture-runner.mjs` (Playwright).
 *
 * Export persisted JSON: `npm run x:catalog:export` → data/x-intel/visual-capture-catalog.json
 */

import type { XIntelFranchise } from "@/lib/x-intel/franchises";
import type { XIntelSurface } from "@/lib/x-intel/queue-types";
import { THERMAL_COMPARE_PRESETS } from "@/features/thermal/lib/thermal-compare-presets";
import { X_INTEL_VIEW_BY_ID, type XIntelViewDef } from "@/lib/x-intel/view-catalog";

export type CaptureProduct = XIntelSurface | "track_record";

/** Handler name in x-capture-runner.mjs */
export type CaptureRecipeId =
  | "thermal_matrix"
  | "thermal_profile"
  | "thermal_depth"
  | "thermal_grid"
  | "helix_tape"
  | "helix_analytics_rail"
  | "helix_net_premium"
  | "helix_top_prints"
  | "helix_top_strikes"
  | "helix_analytics_overlay"
  | "helix_contract_drilldown"
  | "helix_ticker_drawer"
  | "vector_desk"
  | "vector_fullscreen"
  | "vector_compare"
  | "largo_answer"
  | "meridian_timeline"
  | "meridian_analytics_panel"
  | "meridian_event_tab"
  | "meridian_macro_report"
  | "slayer_desk"
  | "slayer_pin_forecaster"
  | "slayer_largo_tab"
  | "nighthawk_deck"
  | "nighthawk_play_panel";

export type CaptureParamDef = {
  key: string;
  label: string;
  required?: boolean;
  /** When set, runner validates against this list. */
  enum?: readonly string[];
  default?: string | number | boolean;
};

export type CaptureCatalogEntry = {
  /** Stable id for manifests + visual memory — usually equals view_id. */
  id: string;
  /** Links to editorial catalog entry when one exists. */
  view_id: string;
  product: CaptureProduct;
  label: string;
  path: string;
  visualization: string;
  recipe: CaptureRecipeId;
  params: CaptureParamDef[];
  clip: { selector: string; max_height?: number };
  verify: string;
  frame: string;
  reach: string[];
  story_tags: readonly string[];
  franchises: readonly XIntelFranchise[];
  rth_only: boolean;
  spx_only?: boolean;
  operator_rule?: string;
  /** How visual-memory signatures dedupe this frame (placeholders: {ticker}, {lens}, …). */
  signature_template: string;
};

const HELIX_FLOOR = ["200k", "500k", "1m", "20m"] as const;
const HELIX_SIDE = ["ALL", "CALL", "PUT"] as const;
const HELIX_DTE = ["all", "0dte", "week", "month+"] as const;
const THERMAL_LENS = ["gex", "vex", "dex", "charm"] as const;
const VECTOR_HORIZON = ["0dte", "weekly", "monthly"] as const;
const VECTOR_TF = ["1", "3", "5", "15", "30", "60"] as const;
const MERIDIAN_TABS = ["summary", "report", "estimates", "positioning", "history"] as const;
const NIGHTHAWK_VIEWS = ["ZERO_DTE", "SWING", "BANGER", "LEGACY"] as const;
const NIGHTHAWK_PANELS = ["thesis", "management", "pnl", "timeline"] as const;

function fromView(
  view: XIntelViewDef,
  over: Partial<CaptureCatalogEntry> & Pick<CaptureCatalogEntry, "recipe" | "clip" | "params" | "signature_template">,
): CaptureCatalogEntry {
  return {
    id: over.id ?? view.id,
    view_id: view.id,
    product: view.surface,
    label: over.label ?? view.label,
    path: view.path,
    visualization: view.visualization,
    recipe: over.recipe,
    params: over.params,
    clip: over.clip,
    verify: view.verify,
    frame: view.frame,
    reach: view.reach,
    story_tags: over.story_tags ?? [],
    franchises: over.franchises ?? [],
    rth_only: view.rth_only,
    spx_only: view.spx_only,
    operator_rule: view.operator_rule ?? over.operator_rule,
    signature_template: over.signature_template,
  };
}

function v(id: string): XIntelViewDef {
  const view = X_INTEL_VIEW_BY_ID[id];
  if (!view) throw new Error(`capture-catalog: missing view-catalog entry ${id}`);
  return view;
}

/** Core matrix capture — ticker + lens + expiry ALL (operator rule 2). */
function thermalMatrixEntries(): CaptureCatalogEntry[] {
  const tickers = ["SPX", "SPY", "QQQ", "TSLA", "NVDA", "AAPL", "META", "IWM"] as const;
  const out: CaptureCatalogEntry[] = [];
  for (const ticker of tickers) {
    for (const lens of THERMAL_LENS) {
      out.push(
        fromView(v("thermal.matrix"), {
          id: `thermal.matrix.${ticker.toLowerCase()}.${lens}`,
          label: `Thermal ${ticker} ${lens.toUpperCase()} matrix (ALL expiry)`,
          recipe: "thermal_matrix",
          params: [
            { key: "ticker", label: "Ticker", required: true, default: ticker },
            { key: "lens", label: "Lens", enum: THERMAL_LENS, default: lens },
            { key: "expiry_scope", label: "Expiry scope", enum: ["all"], default: "all" },
          ],
          clip: { selector: ".thermal-desk-capture-root, .gex-heatmap-desk", max_height: 980 },
          story_tags: ["gamma", "walls", "regime", lens],
          franchises: lens === "gex" ? ["GAMMA_SHIFT", "LEVEL_THAT_MATTERS"] : ["GAMMA_SHIFT"],
          signature_template: "thermal.matrix|{ticker}|lens={lens}|expiry=all",
        }),
      );
    }
  }
  return out;
}

function thermalGridEntries(): CaptureCatalogEntry[] {
  return THERMAL_COMPARE_PRESETS.map((preset) =>
    fromView(v("thermal.sector_grid"), {
      id: `thermal.sector_grid.${preset.id}`,
      label: `Thermal ${preset.label} compare grid`,
      recipe: "thermal_grid",
      params: [
        { key: "compare_set", label: "Sector preset", required: true, enum: THERMAL_COMPARE_PRESETS.map((p) => p.id), default: preset.id },
      ],
      clip: { selector: ".thermal-desk-capture-root, .thermal-triple-desk", max_height: 1000 },
      story_tags: ["sector", "compare", preset.id],
      franchises: ["MARKET_PULSE", "BLACKOUT_CONFLUENCE"],
      signature_template: "thermal.sector_grid|preset={compare_set}",
    }),
  );
}

function helixTapeVariants(): CaptureCatalogEntry[] {
  const base = v("helix.tape");
  const combos: Array<{
    suffix: string;
    label: string;
    defaults: Record<string, string | number | boolean>;
    tags: string[];
    franchises: XIntelFranchise[];
  }> = [
    { suffix: "default", label: "Helix tape — market", defaults: {}, tags: ["flow"], franchises: ["WHALE_WATCH"] },
    { suffix: "whales", label: "Helix tape — whales", defaults: { whales: true }, tags: ["whale"], franchises: ["WHALE_WATCH"] },
    { suffix: "0dte", label: "Helix tape — 0DTE", defaults: { dte: "0dte" }, tags: ["0dte"], franchises: ["WHALE_WATCH"] },
    { suffix: "indices", label: "Helix tape — indices", defaults: { indices: true }, tags: ["indices"], franchises: ["MARKET_PULSE"] },
    { suffix: "1m", label: "Helix tape — $1M floor", defaults: { min_premium: "1m" }, tags: ["whale"], franchises: ["WHALE_WATCH"] },
    { suffix: "calls", label: "Helix tape — calls only", defaults: { side: "CALL" }, tags: ["calls"], franchises: ["WHALE_WATCH"] },
    { suffix: "puts", label: "Helix tape — puts only", defaults: { side: "PUT" }, tags: ["puts"], franchises: ["WHALE_WATCH"] },
  ];
  const tickers = ["SPX", "SPY", "NVDA", "TSLA", "AAPL", "META"] as const;

  const out: CaptureCatalogEntry[] = [];
  for (const combo of combos) {
    for (const ticker of tickers) {
      out.push({
        id: `helix.tape.${ticker.toLowerCase()}.${combo.suffix}`,
        view_id: base.id,
        product: "helix",
        label: `${combo.label} · ${ticker}`,
        path: base.path,
        visualization: base.visualization,
        recipe: "helix_tape",
        params: [
          { key: "ticker", label: "Symbol filter", default: ticker },
          { key: "min_premium", label: "Floor", enum: HELIX_FLOOR, default: combo.defaults.min_premium ?? "200k" },
          { key: "side", label: "Side", enum: HELIX_SIDE, default: combo.defaults.side ?? "ALL" },
          { key: "dte", label: "DTE", enum: HELIX_DTE, default: combo.defaults.dte ?? "all" },
          { key: "whales", label: "Whales chip", default: combo.defaults.whales ?? false },
          { key: "indices", label: "Indices chip", default: combo.defaults.indices ?? false },
          { key: "analytics", label: "Analytics open", default: false },
        ],
        clip: { selector: ".helix-desk-terminal, .helix-pro-desk", max_height: 920 },
        verify: base.verify,
        frame: base.frame,
        reach: base.reach,
        story_tags: combo.tags,
        franchises: combo.franchises,
        rth_only: true,
        operator_rule: base.operator_rule,
        signature_template: `helix.tape|{ticker}|floor={min_premium}|side={side}|dte={dte}|whales={whales}|indices={indices}`,
      });
    }
  }
  return out;
}

function helixAnalyticsEntries(): CaptureCatalogEntry[] {
  const entries: Array<Partial<CaptureCatalogEntry> & { view_id: string; recipe: CaptureRecipeId; clip: CaptureCatalogEntry["clip"] }> = [
    {
      view_id: "helix.top_prints",
      recipe: "helix_top_prints",
      clip: { selector: ".helix-top-strikes-panel, .helix-pro-rail-panel", max_height: 720 },
      signature_template: "helix.top_prints|scope={ticker_or_market}",
      story_tags: ["conviction", "prints"],
      franchises: ["WHALE_WATCH"],
    },
    {
      view_id: "helix.top_strikes",
      recipe: "helix_top_strikes",
      clip: { selector: ".helix-top-strikes-panel", max_height: 720 },
      signature_template: "helix.top_strikes|{ticker}",
      story_tags: ["stack", "repeat"],
      franchises: ["WHALE_WATCH"],
    },
    {
      view_id: "helix.analytics_panels",
      recipe: "helix_analytics_overlay",
      clip: { selector: ".helix-analytics-overlay-grid", max_height: 920 },
      signature_template: "helix.analytics_panels|market",
      story_tags: ["analytics", "breadth"],
      franchises: ["MARKET_PULSE"],
    },
    {
      view_id: "helix.contract_drilldown",
      recipe: "helix_contract_drilldown",
      clip: { selector: "[role='dialog'], .helix-contract-drilldown", max_height: 920 },
      signature_template: "helix.contract_drilldown|{ticker}|{strike}{side}",
      story_tags: ["contract", "drilldown"],
      franchises: ["WHALE_WATCH"],
    },
  ];

  return entries.map((e) =>
    fromView(v(e.view_id!), {
      ...e,
      params: [
        { key: "ticker", label: "Scope ticker", default: "SPX" },
        { key: "pick", label: "Row to open", enum: ["top_premium", "first_visible"], default: "top_premium" },
      ],
      signature_template: e.signature_template!,
      story_tags: e.story_tags ?? [],
      franchises: e.franchises ?? [],
    }),
  );
}

function vectorEntries(): CaptureCatalogEntry[] {
  const tickers = ["SPX", "SPY", "TSLA", "NVDA", "QQQ"] as const;
  const out: CaptureCatalogEntry[] = [];
  for (const ticker of tickers) {
    for (const horizon of VECTOR_HORIZON) {
      for (const tf of ["15", "5"] as const) {
        out.push(
          fromView(v("vector.desk"), {
            id: `vector.desk.${ticker.toLowerCase()}.${horizon}.${tf}m`,
            label: `Vector ${ticker} ${horizon} ${tf}m desk`,
            recipe: "vector_desk",
            params: [
              { key: "ticker", label: "Ticker", required: true, default: ticker },
              { key: "horizon", label: "Horizon", enum: VECTOR_HORIZON, default: horizon },
              { key: "timeframe", label: "Timeframe (min)", enum: VECTOR_TF, default: tf },
              { key: "lens", label: "Wall lens", enum: ["gex", "vex"], default: "gex" },
            ],
            clip: { selector: ".vector-chart-wrap", max_height: 920 },
            story_tags: ["structure", "walls", horizon],
            franchises: ["LEVEL_THAT_MATTERS", "GAMMA_SHIFT"],
            signature_template: "vector.desk|{ticker}|horizon={horizon}|tf={timeframe}|lens={lens}",
          }),
        );
      }
    }
  }
  out.push(
    fromView(v("vector.compare"), {
      id: "vector.compare.mag7",
      label: "Vector compare — Mag 7",
      recipe: "vector_compare",
      params: [{ key: "preset", label: "Compare preset", enum: ["mag7", "indices", "semis", "momentum"], default: "mag7" }],
      clip: { selector: ".vector-compare-desk, .vector-chart-wrap", max_height: 920 },
      story_tags: ["compare", "sector"],
      franchises: ["MARKET_PULSE"],
      signature_template: "vector.compare|preset={preset}",
    }),
    fromView(v("vector.fullscreen"), {
      id: "vector.fullscreen.spx",
      label: "Vector SPX full-screen chart",
      recipe: "vector_fullscreen",
      params: [
        { key: "ticker", label: "Ticker", default: "SPX" },
        { key: "horizon", label: "Horizon", enum: VECTOR_HORIZON, default: "0dte" },
        { key: "timeframe", label: "Timeframe (min)", enum: VECTOR_TF, default: "15" },
      ],
      clip: { selector: ".vector-chart-wrap", max_height: 920 },
      story_tags: ["structure", "fullscreen"],
      franchises: ["LEVEL_THAT_MATTERS"],
      signature_template: "vector.fullscreen|{ticker}|horizon={horizon}",
    }),
  );
  return out;
}

function largoEntries(): CaptureCatalogEntry[] {
  const questions: Array<{ id: string; label: string; question: string; tags: string[]; franchises: XIntelFranchise[] }> = [
    {
      id: "largo.gamma_read",
      label: "Largo gamma read",
      question: "What's the {ticker} gamma setup — flip, walls, regime, and the one level that matters?",
      tags: ["gamma", "explain"],
      franchises: ["GAMMA_SHIFT", "BLACKOUT_CONFLUENCE"],
    },
    {
      id: "largo.flow_why",
      label: "Largo flow explain",
      question: "Why is {ticker} seeing this flow — who's paying up and what does dealer positioning imply?",
      tags: ["flow", "explain"],
      franchises: ["WHALE_WATCH"],
    },
    {
      id: "largo.spx_shift",
      label: "Largo SPX shift",
      question: "What changed in SPX in the last 15 minutes — gamma, flow, and levels?",
      tags: ["spx", "shift"],
      franchises: ["GAMMA_SHIFT", "SIGNAL_CONFLICT"],
    },
    {
      id: "largo.wall_weak",
      label: "Largo wall test",
      question: "Is the {strike} wall on {ticker} actually weakening or just being tested?",
      tags: ["wall", "level"],
      franchises: ["LEVEL_THAT_MATTERS"],
    },
    {
      id: "largo.conflict",
      label: "Largo systems disagree",
      question: "Helix and Thermal disagree on {ticker} — reconcile the flow vs gamma read.",
      tags: ["conflict", "reconcile"],
      franchises: ["SIGNAL_CONFLICT", "BLACKOUT_CONFLUENCE"],
    },
    {
      id: "largo.board_best",
      label: "Largo best setup",
      question: "What's the strongest setup on the board right now and why?",
      tags: ["board", "setup"],
      franchises: ["BLACKOUT_CONFLUENCE"],
    },
  ];

  return questions.map((q) =>
    fromView(v("largo.answer"), {
      id: q.id,
      label: q.label,
      recipe: "largo_answer",
      params: [
        { key: "question", label: "Question template", required: true, default: q.question },
        { key: "ticker", label: "Ticker substitute", default: "SPX" },
        { key: "strike", label: "Strike substitute", default: "7800" },
      ],
      clip: { selector: ".largo-terminal-fullpage, .desk-largo-panel", max_height: 980 },
      story_tags: q.tags,
      franchises: q.franchises,
      signature_template: `${q.id}|{ticker}`,
    }),
  );
}

function meridianEntries(): CaptureCatalogEntry[] {
  const tabToView: Record<(typeof MERIDIAN_TABS)[number], string> = {
    summary: "meridian.event_summary",
    report: "meridian.event_report",
    estimates: "meridian.event_estimates",
    positioning: "meridian.event_positioning",
    history: "meridian.event_history",
  };
  const tabs = MERIDIAN_TABS;
  const tickers = ["NVDA", "TSLA", "AAPL", "META", "AMZN"] as const;
  const out: CaptureCatalogEntry[] = [];

  for (const ticker of tickers) {
    for (const tab of tabs) {
      const viewId = tabToView[tab];
      out.push(
        fromView(v(viewId), {
          id: `meridian.event.${ticker.toLowerCase()}.${tab}`,
          label: `Meridian ${ticker} — ${tab}`,
          recipe: "meridian_event_tab",
          params: [
            { key: "ticker", label: "Ticker", required: true, default: ticker },
            { key: "tab", label: "Tab", enum: tabs, default: tab },
            { key: "min_impact", label: "Cohort", enum: ["high", "medium"], default: "high" },
          ],
          clip: { selector: ".meridian-earnings-tabs, .meridian-detail-v2", max_height: 980 },
          story_tags: ["earnings", tab],
          franchises: ["EARNINGS_WAR_ROOM"],
          signature_template: `meridian.event|{ticker}|tab={tab}`,
        }),
      );
    }
  }

  const analyticsPanels = [
    { viewId: "meridian.high_impact_grid", panel: "high_impact" },
    { viewId: "meridian.calendar_heat", panel: "calendar_heat" },
    { viewId: "meridian.megacap_week", panel: "megacap_week" },
    { viewId: "meridian.next_24h", panel: "next_24h" },
    { viewId: "meridian.surprise_scatter", panel: "surprise_scatter" },
    { viewId: "meridian.revision_timeline", panel: "revision_timeline" },
    { viewId: "meridian.opex_cross_market", panel: "high_impact" },
    { viewId: "meridian.after_hours", panel: "after_hours" },
  ] as const;

  for (const { viewId, panel } of analyticsPanels) {
    out.push(
      fromView(v(viewId), {
        recipe: "meridian_analytics_panel",
        params: [{ key: "panel", label: "Panel section", default: panel }],
        clip: { selector: ".meridian-analytics-grid, .meridian-earnings-week, .meridian-earnings-analytics", max_height: 720 },
        story_tags: ["catalyst", "calendar"],
        franchises: ["EARNINGS_WAR_ROOM", "MARKET_PULSE"],
        signature_template: `${viewId}|desk=analytics|panel=${panel}`,
      }),
    );
  }

  out.push(
    fromView(v("meridian.macro_report"), {
      recipe: "meridian_macro_report",
      params: [{ key: "event", label: "Macro slug", default: "CPI" }],
      clip: { selector: ".meridian-detail-v2", max_height: 980 },
      story_tags: ["macro", "cpi", "fomc"],
      franchises: ["BEFORE_THE_BELL", "MARKET_PULSE"],
      signature_template: "meridian.macro|{event}",
    }),
  );

  return out;
}

function slayerEntries(): CaptureCatalogEntry[] {
  return [
    fromView(v("spx_slayer.desk"), {
      recipe: "slayer_desk",
      params: [],
      clip: { selector: ".spx-desk, main", max_height: 980 },
      story_tags: ["spx", "play_engine"],
      franchises: ["MARKET_PULSE", "GAMMA_SHIFT"],
      signature_template: "spx_slayer.desk",
    }),
    fromView(v("spx_slayer.desk"), {
      id: "spx_slayer.header_stats",
      label: "SPX Slayer header stats row",
      recipe: "slayer_desk",
      params: [{ key: "focus", label: "Frame focus", default: "header" }],
      clip: { selector: ".spx-desk-top-stats--strip, .spx-desk-top-stats", max_height: 200 },
      story_tags: ["spx", "stats", "pulse"],
      franchises: ["MARKET_PULSE"],
      signature_template: "spx_slayer.header_stats",
    }),
    fromView(v("spx_slayer.desk"), {
      id: "spx_slayer.gex_rail",
      label: "SPX Slayer 0DTE GEX matrix rail",
      recipe: "slayer_desk",
      params: [{ key: "lens", label: "Lens", enum: ["gex", "vex"], default: "gex" }],
      clip: { selector: ".gex-heatmap-desk, .spx-sniper-matrix", max_height: 980 },
      story_tags: ["gamma", "matrix", "spx"],
      franchises: ["GAMMA_SHIFT", "LEVEL_THAT_MATTERS"],
      signature_template: "spx_slayer.gex_rail|lens={lens}",
    }),
    fromView(v("spx_slayer.pin_forecaster"), {
      recipe: "slayer_pin_forecaster",
      params: [{ key: "expand_why", label: "Expand why pin", default: true }],
      clip: { selector: ".spx-pin-forecaster, .spx-desk", max_height: 720 },
      story_tags: ["pin", "eod"],
      franchises: ["LEVEL_THAT_MATTERS"],
      signature_template: "spx_slayer.pin|why={expand_why}",
    }),
    fromView(v("spx_slayer.largo_read"), {
      recipe: "slayer_largo_tab",
      params: [],
      clip: { selector: ".spx-largo-rail, .spx-desk", max_height: 720 },
      story_tags: ["commentary", "spx"],
      franchises: ["MARKET_PULSE"],
      signature_template: "spx_slayer.largo_tab",
    }),
  ];
}

function nighthawkEntries(): CaptureCatalogEntry[] {
  const out: CaptureCatalogEntry[] = [
    fromView(v("nighthawk.closed_winners"), {
      id: "nighthawk.closed_winners",
      label: "Night Hawk closed winners stack",
      recipe: "nighthawk_deck",
      params: [
        { key: "view", label: "View", enum: NIGHTHAWK_VIEWS, default: "ZERO_DTE" },
        { key: "tab", label: "Board tab", enum: ["closed"], default: "closed" },
      ],
      clip: { selector: ".nh-deck, .nighthawk-content-canvas", max_height: 980 },
      story_tags: ["0dte", "receipts", "closed"],
      franchises: ["RECEIPTS", "NIGHT_HAWK_STRIKE"],
      signature_template: "nighthawk.closed|tab=closed",
    }),
  ];
  for (const view of NIGHTHAWK_VIEWS) {
    out.push(
      fromView(v("nighthawk.queue"), {
        id: `nighthawk.deck.${view.toLowerCase()}`,
        label: `Night Hawk ${view} deck`,
        recipe: "nighthawk_deck",
        params: [{ key: "view", label: "View", enum: NIGHTHAWK_VIEWS, default: view }],
        clip: { selector: ".nh-deck, .nighthawk-content-canvas", max_height: 980 },
        story_tags: ["0dte", "board", view.toLowerCase()],
        franchises: view === "ZERO_DTE" ? ["NIGHT_HAWK_STRIKE"] : ["MARKET_PULSE"],
        signature_template: `nighthawk.deck|view={view}`,
      }),
    );
  }
  for (const panel of NIGHTHAWK_PANELS) {
    const viewId = `nighthawk.${panel}` as "nighthawk.thesis" | "nighthawk.management" | "nighthawk.pnl" | "nighthawk.timeline";
    out.push(
      fromView(v(viewId), {
        id: `nighthawk.play.${panel}`,
        recipe: "nighthawk_play_panel",
        params: [
          { key: "ticker", label: "Play ticker", default: "SPX" },
          { key: "panel", label: "Panel", enum: NIGHTHAWK_PANELS, default: panel },
        ],
        clip: { selector: ".nh-deck, .PlayTerminal", max_height: 920 },
        story_tags: ["play", panel],
        franchises: ["NIGHT_HAWK_STRIKE", "RECEIPTS"],
        signature_template: `nighthawk.play|{ticker}|panel={panel}`,
      }),
    );
  }
  return out;
}

/** Full scout catalog — every capturable state indexed for search + reuse. */
export const VISUAL_CAPTURE_CATALOG: readonly CaptureCatalogEntry[] = [
  ...thermalMatrixEntries(),
  fromView(v("thermal.gamma_profile"), {
    recipe: "thermal_profile",
    params: [
      { key: "ticker", label: "Ticker", default: "SPY" },
      { key: "lens", label: "Lens", enum: THERMAL_LENS, default: "gex" },
    ],
    clip: { selector: ".thermal-desk-capture-root, .gex-heatmap-desk", max_height: 980 },
    story_tags: ["profile", "curve"],
    franchises: ["GAMMA_SHIFT"],
    signature_template: "thermal.profile|{ticker}|lens={lens}",
  }),
  fromView(v("thermal.forced_flow"), {
    recipe: "thermal_depth",
    params: [{ key: "ticker", label: "Ticker", default: "SPX" }],
    clip: { selector: ".thermal-desk-capture-root, .gex-heatmap-desk", max_height: 980 },
    story_tags: ["depth", "forced_flow"],
    franchises: ["GAMMA_SHIFT", "LEVEL_THAT_MATTERS"],
    signature_template: "thermal.depth|{ticker}",
  }),
  ...thermalGridEntries(),
  ...helixTapeVariants(),
  ...helixAnalyticsEntries(),
  fromView(v("helix.tape"), {
    id: "helix.ticker_drawer",
    view_id: "helix.tape",
    label: "Helix ticker drawer — all prints for symbol",
    recipe: "helix_ticker_drawer",
    params: [{ key: "ticker", label: "Ticker", required: true, default: "NVDA" }],
    clip: { selector: "[role='dialog'], .ticker-drawer", max_height: 920 },
    story_tags: ["drawer", "aggregate"],
    franchises: ["WHALE_WATCH"],
    signature_template: "helix.ticker_drawer|{ticker}",
  }),
  fromView(v("helix.tape"), {
    id: "helix.analytics_rail.market",
    label: "Helix analytics rail — market",
    recipe: "helix_analytics_rail",
    params: [{ key: "ticker", label: "Optional ticker scope", default: "" }],
    clip: { selector: ".helix-desk-analytics-rail", max_height: 920 },
    story_tags: ["analytics", "rail"],
    franchises: ["WHALE_WATCH", "MARKET_PULSE"],
    signature_template: "helix.analytics_rail|{ticker_or_market}",
  }),
  fromView(v("helix.tape"), {
    id: "helix.net_premium",
    label: "Helix net premium leaderboard",
    recipe: "helix_net_premium",
    params: [],
    clip: { selector: ".helix-pro-rail-panel", max_height: 640 },
    story_tags: ["net_premium", "breadth"],
    franchises: ["MARKET_PULSE"],
    signature_template: "helix.net_premium|market",
  }),
  ...vectorEntries(),
  ...largoEntries(),
  ...meridianEntries(),
  ...slayerEntries(),
  ...nighthawkEntries(),
];

export const VISUAL_CAPTURE_BY_ID: Readonly<Record<string, CaptureCatalogEntry>> = Object.fromEntries(
  VISUAL_CAPTURE_CATALOG.map((e) => [e.id, e]),
);

export const CAPTURE_PRODUCTS: readonly CaptureProduct[] = [
  "helix",
  "thermal",
  "vector",
  "nighthawk",
  "meridian",
  "largo",
  "spx_slayer",
];

/** Group catalog by product for UI / agent browsing. */
export function captureCatalogByProduct(): Record<CaptureProduct, CaptureCatalogEntry[]> {
  const out = Object.fromEntries(CAPTURE_PRODUCTS.map((p) => [p, [] as CaptureCatalogEntry[]])) as Record<
    CaptureProduct,
    CaptureCatalogEntry[]
  >;
  for (const entry of VISUAL_CAPTURE_CATALOG) {
    if (!out[entry.product]) out[entry.product] = [];
    out[entry.product].push(entry);
  }
  return out;
}

export function resolveSignatureTemplate(
  entry: CaptureCatalogEntry,
  params: Record<string, string | number | boolean | undefined>,
): string {
  let sig = entry.signature_template;
  for (const [k, v] of Object.entries(params)) {
    sig = sig.replaceAll(`{${k}}`, String(v ?? ""));
  }
  sig = sig.replaceAll("{ticker_or_market}", String(params.ticker || "market"));
  return sig;
}

/** JSON-serializable export for scripts + agent memory. */
export function exportCaptureCatalogJson(): {
  version: number;
  exported_at: string;
  product_count: number;
  entry_count: number;
  products: Record<
    string,
    Array<Omit<CaptureCatalogEntry, "franchises" | "story_tags"> & { franchises: string[]; story_tags: string[] }>
  >;
} {
  const grouped = captureCatalogByProduct();
  const products: Record<string, CaptureCatalogEntry[]> = {};
  for (const [product, entries] of Object.entries(grouped)) {
    products[product] = entries;
  }
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    product_count: CAPTURE_PRODUCTS.length,
    entry_count: VISUAL_CAPTURE_CATALOG.length,
    products: Object.fromEntries(
      Object.entries(products).map(([k, entries]) => [
        k,
        entries.map((e) => ({
          ...e,
          franchises: [...e.franchises],
          story_tags: [...e.story_tags],
        })),
      ]),
    ),
  };
}

/** Search catalog for story planning — tag/franchise/ticker filters. */
export function searchCaptureCatalog(opts: {
  product?: CaptureProduct;
  story_tag?: string;
  franchise?: XIntelFranchise;
  ticker?: string;
}): CaptureCatalogEntry[] {
  return VISUAL_CAPTURE_CATALOG.filter((e) => {
    if (opts.product && e.product !== opts.product) return false;
    if (opts.story_tag && !e.story_tags.includes(opts.story_tag)) return false;
    if (opts.franchise && !e.franchises.includes(opts.franchise)) return false;
    if (opts.ticker) {
      const t = opts.ticker.toUpperCase();
      const idHit = e.id.toUpperCase().includes(t);
      const tickerParam = e.params.find((p) => p.key === "ticker");
      const matchesDefault = tickerParam?.default === t;
      // An entry with a ticker param can be re-targeted to any ticker at generation time (its
      // default is just a placeholder), so it stays in scope even when the default doesn't match
      // the search. Only an entry with NO override path — no ticker param, no id/default hit,
      // and not the SPX-wide catch-all — is actually out of scope for this ticker.
      if (!idHit && !matchesDefault && !e.spx_only && !tickerParam) return false;
    }
    return true;
  });
}
