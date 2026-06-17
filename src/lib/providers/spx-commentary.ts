import { anthropicText } from "./anthropic";
import type { SpxDeskPayload } from "./spx-desk";

export type SpxCommentaryResult = {
  headline: string;
  bias: "bullish" | "bearish" | "neutral";
  body: string;
  watch: string[];
  changed: string[];
  as_of: string;
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function computeDelta(
  desk: SpxDeskPayload,
  prev?: Partial<SpxDeskPayload> | null
): string[] {
  if (!prev?.price) return ["Initial desk snapshot — establishing baseline."];

  const lines: string[] = [];
  const dp = desk.price - prev.price;
  if (Math.abs(dp) >= 0.5) {
    lines.push(`SPX ${dp >= 0 ? "+" : ""}${dp.toFixed(2)} pts (${fmt(prev.price)} → ${fmt(desk.price)})`);
  }

  if (prev.vwap != null && desk.vwap != null) {
    const wasAbove = prev.price >= prev.vwap;
    const nowAbove = desk.price >= desk.vwap;
    if (wasAbove !== nowAbove) {
      lines.push(nowAbove ? "Crossed above VWAP" : "Lost VWAP — now below session average");
    }
  }

  if (prev.regime && desk.regime && prev.regime !== desk.regime) {
    lines.push(`Regime shift: ${prev.regime} → ${desk.regime}`);
  }

  if (prev.gex_king != null && desk.gex_king != null && prev.gex_king !== desk.gex_king) {
    lines.push(`GEX king moved: ${fmt(prev.gex_king)} → ${fmt(desk.gex_king)}`);
  }

  if (prev.tide_bias && desk.tide_bias && prev.tide_bias !== desk.tide_bias) {
    lines.push(`Market tide: ${prev.tide_bias} → ${desk.tide_bias}`);
  }

  if (prev.hod != null && desk.hod != null && desk.hod > prev.hod + 0.25) {
    lines.push(`New session HOD: ${fmt(desk.hod)}`);
  }
  if (prev.lod != null && desk.lod != null && desk.lod < prev.lod - 0.25) {
    lines.push(`New session LOD: ${fmt(desk.lod)}`);
  }

  if (lines.length === 0) {
    lines.push("Tape quiet — levels holding, monitoring for structure breaks.");
  }

  return lines;
}

function deskContext(desk: SpxDeskPayload): Record<string, unknown> {
  return {
    price: desk.price,
    change_pct: desk.spx_change_pct,
    vix: desk.vix,
    vix_change_pct: desk.vix_change_pct,
    above_vwap: desk.above_vwap,
    lod: desk.lod,
    hod: desk.hod,
    vwap: desk.vwap,
    pdh: desk.pdh,
    pdl: desk.pdl,
    ema20: desk.ema20,
    ema50: desk.ema50,
    ema200: desk.ema200,
    sma50: desk.sma50,
    sma200: desk.sma200,
    tick: desk.tick,
    trin: desk.trin,
    add: desk.add,
    gex_net: desk.gex_net,
    gex_king: desk.gex_king,
    max_pain: desk.max_pain,
    gamma_flip: desk.gamma_flip,
    gamma_regime: desk.gamma_regime,
    above_gamma_flip: desk.above_gamma_flip,
    gex_walls: desk.gex_walls?.slice(0, 5),
    flow_0dte_call: desk.flow_0dte_call_premium,
    flow_0dte_put: desk.flow_0dte_put_premium,
    flow_0dte_net: desk.flow_0dte_net,
    tide_bias: desk.tide_bias,
    tide_call: desk.tide_call_premium,
    tide_put: desk.tide_put_premium,
    nope: desk.nope,
    nope_net_delta: desk.nope_net_delta,
    iv_rank: desk.uw_iv_rank,
    regime: desk.regime,
    vix_term: desk.vix_term,
    dark_pool: desk.dark_pool
      ? {
          bias: desk.dark_pool.bias,
          total: desk.dark_pool.total_premium,
          prints: desk.dark_pool.prints.length,
        }
      : null,
    recent_flows: desk.spx_flows?.slice(0, 5),
    tape_highlights: desk.unified_tape?.slice(0, 5),
    oi_changes: desk.oi_changes?.slice(0, 4),
    macro_today: desk.macro_events?.slice(0, 3),
    key_levels: desk.levels?.slice(0, 8),
  };
}

function parseCommentaryJson(raw: string): SpxCommentaryResult | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const bias = String(parsed.bias ?? "neutral").toLowerCase();
    const validBias =
      bias === "bullish" || bias === "bearish" ? bias : ("neutral" as const);

    return {
      headline: String(parsed.headline ?? "Desk update"),
      bias: validBias,
      body: String(parsed.body ?? ""),
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String).slice(0, 5) : [],
      changed: Array.isArray(parsed.changed) ? parsed.changed.map(String).slice(0, 6) : [],
      as_of: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function generateSpxCommentary(
  desk: SpxDeskPayload,
  previous?: Partial<SpxDeskPayload> | null
): Promise<SpxCommentaryResult | null> {
  const delta = computeDelta(desk, previous);

  const prompt = `You are the lead mentor for BlackOut SPX-Sniper — a 0DTE SPX index options desk. Write a live desk commentary update for members watching the dashboard.

CURRENT DESK (JSON):
${JSON.stringify(deskContext(desk), null, 0)}

WHAT CHANGED SINCE LAST UPDATE:
${delta.map((d) => `- ${d}`).join("\n")}

Respond with ONLY valid JSON (no markdown fences):
{
  "headline": "One punchy line — max 12 words",
  "bias": "bullish" | "bearish" | "neutral",
  "body": "3-5 short bullet lines separated by \\n. Cover: price vs VWAP, dealer/GEX/dark pool context, 0DTE flow bias, recent tape, what changed, what to expect next 15-30 min. Mentor voice — direct, no hype, no disclaimers.",
  "watch": ["level or trigger 1", "level or trigger 2", "level or trigger 3"],
  "changed": ["what shifted 1", "what shifted 2"]
}

Rules:
- SPX index prices only. Round to .00.
- Cite real numbers from the desk data.
- If flow/GEX missing, say "dealer data loading" — do not invent.
- Max 120 words in body.`;

  const raw = await anthropicText(prompt, 700);
  if (!raw) return null;

  const parsed = parseCommentaryJson(raw);
  if (parsed) {
    if (!parsed.changed.length) parsed.changed = delta.slice(0, 4);
    return parsed;
  }

  return {
    headline: "Desk update",
    bias: "neutral",
    body: raw.slice(0, 800),
    watch: [],
    changed: delta,
    as_of: new Date().toISOString(),
  };
}
