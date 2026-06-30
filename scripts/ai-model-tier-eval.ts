/**
 * Side-by-side Sonnet vs Haiku on 3 representative BlackOut AI surfaces.
 * Run: npx tsx scripts/ai-model-tier-eval.ts
 * Output: scripts/ai-model-tier-eval-results.json + console summary
 */
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import { fetchGexHeatmap, type GexHeatmap } from "@/lib/providers/polygon-options-gex";

const SONNET = "claude-sonnet-4-6";
const HAIKU = "claude-haiku-4-5";
const MODELS = [SONNET, HAIKU] as const;

const GEX_SYSTEM = [
  "You are Largo, BlackOut's options desk analyst. Read dealer positioning for a single ticker",
  "and explain, in 3 to 5 concrete sentences, what it means for that ticker RIGHT NOW:",
  "the gamma regime (long vs short), the key levels to watch (call/put walls, gamma flip,",
  "max pain), and what would change the read (a flip cross, a wall melting, etc.).",
  "Ground EVERY statement ONLY in the data provided — never invent levels or numbers.",
  "This is market-structure analysis, NOT financial advice: give NO buy/sell directives,",
  "no price targets, no position sizing. Plain desk language, no preamble, no disclaimers,",
  "no bullet lists — just the read.",
].join(" ");

const NW_SYSTEM = `You are BlackOut's options desk analyst writing a short, technically precise read on ONE of the user's option positions.
RULES:
- Ground EVERY statement ONLY in the SIGNALS provided below. NEVER invent or estimate a price, level, Greek, premium, percentage, or date that is not in the data. If a field shows "n/a", do not mention it.
- Do NOT compute or state the number of days between two dates yourself (you make arithmetic errors). Only cite day-counts that are explicitly provided (e.g. DTE, "in Nd"). State date relationships ONLY as given — e.g. say "before this expiry" / "after this expiry" when told, never your own day-gap like "four days after".
- Explain WHY the engine's call (hold / trim / sell / watch) is reasonable given the signals — reference the ACTUAL flow lean, dealer-gamma walls, trend, key levels, catalysts, and the position's P&L / DTE / Greeks that are provided.
- 3 to 5 tight sentences. Desk tone: direct, professional, no hype, no emoji, no markdown headers, no bullet points.
- Do NOT give personalized financial advice, position sizing, or guarantees — describe the setup and the engine's reasoning. No disclaimer (the UI adds one).`;

/** Night's Watch — long NVDA call, mixed signals, engine says TRIM (realistic premium pain). */
const NW_CONTEXT = `POSITION: NVDA 145C long x4, expiry 2026-07-18, entry 8.40.
ENGINE VERDICT: TRIM (medium confidence). Signals: DTE compressing with theta bleed accelerating; spot below VWAP and under 20d mid-range; call-skew flow faded last 4h; dealer gamma flipped short below 142.50.
P&L: unrealized $-620 (-18.5%). DTE 18. Breakeven 153.40. Dist-to-strike -2.1%. Valuation underwater.
GREEKS: mark 6.85, delta 0.42, gamma 0.0180, theta/day -0.38, IV 52%.
DEALER GAMMA: regime short_gamma, flip 142.50, max-pain 140.00, anchor 138.00, walls put 140.00, call 150.00.
OPTIONS FLOW (24h): lean bearish, calls $18.2M vs puts $31.4M over 847 prints. Top strikes: 140P $4.1M, 150C $3.2M, 145C $2.8M.
TECHNICALS: trend down, price 142.05, RSI(d) 41, ATR 4.85, 20d range 128.20–152.80. Key levels: support 140.00, resistance 145.00, VWAP 143.80.
CATALYST: earnings 2026-08-20 (in 51d) — AFTER this expiry.
SPX CONFLUENCE: chop grade C (score 52), 2 agree / 3 conflict. Entry n/a, stop n/a, target n/a.
DETERMINISTIC DIRECTIVE: Reduce size into negative gamma; do not add; reassess if spot reclaims 145 with bullish flow confirmation.`;

/** SPX play gate — grade A- long but mixed MTF + opposing dark pool (should veto or approve?). */
const SPX_GATE_PROMPT = `You are the SPX 0DTE quality arbiter for BlackOut Ops. We want FEW, HIGH-QUALITY plays — veto aggressively.

APPROVE_BUY only if ALL are true:
- Grade A or A+ confluence
- 3m AND 5m timeframe align with direction
- Clear support/resistance or breakout context
- Flow, tide, and news do NOT oppose the trade
- Risk/reward to stop and target is sensible for 0DTE

Default to VETO when anything is mixed.

PRICE & STRUCTURE:
{"price":6012.25,"vwap":6016.80,"above_vwap":false,"hod":6024.50,"lod":6001.75,"pdh":6031.00,"pdl":5988.25,"regime":"negative_gamma","nearest_support":[{"kind":"support","price":6004.00,"label":"gamma wall"},{"kind":"support","price":5992.00,"label":"PDL"}],"nearest_resistance":[{"kind":"resistance","price":6018.00,"label":"gamma flip"},{"kind":"resistance","price":6025.00,"label":"call wall"}]}

DEALER / GEX:
{"gamma_flip":6018.00,"gamma_regime":"short_gamma","gex_king":6005.00,"max_pain":6000.00,"gex_walls":[{"strike":6025,"net_gex":-8200000},{"strike":6018,"net_gex":-4100000},{"strike":6004,"net_gex":5600000}]}

FLOW & TAPE:
{"flow_0dte_net":-12400000,"tide_bias":"bearish","dark_pool":"sell","spx_flows":[{"type":"block","side":"put","premium":4200000},{"type":"sweep","side":"put","premium":1800000}],"live_tape":["6010P sweep $2.1M","6020C block $900k"],"nope":-0.42}

MULTI-TIMEFRAME (Polygon 1m bars):
{"m3_close":6011.80,"m5_close":6012.10,"m5_ema20":6014.50,"m5_rsi":44,"m5_trend":"down","breakout":null,"mtf":{"m3":"bearish","m5":"bearish","align":true}}

NEWS & MACRO:
{"headlines":["Fed speaker: data-dependent, no rush to cut"],"macro":[{"event":"FOMC minutes","time":"14:00 ET"}],"vix":15.8,"iv_rank":38}

CONFLUENCE:
{"score":82,"grade":"A-","direction":"short","conflicts":1,"agreeing":5,"factors":["Below VWAP and gamma flip","0DTE put skew 1.6x","Negative dealer gamma","M5 trend down","Dark pool sell bias"],"levels":{"entry":6010.00,"stop":6019.50,"target":5998.00}}

CONFIRMATION CHECKLIST (5/6):
[{"name":"grade","pass":true},{"name":"mtf_align","pass":true},{"name":"sr_context","pass":true},{"name":"flow_support","pass":false,"note":"0DTE net negative but direction is short — aligned"},{"name":"news_clear","pass":true},{"name":"rr_sensible","pass":true}]

Respond ONLY valid JSON (verdict must be exactly "APPROVE_BUY" or "VETO"):
{
  "verdict": "APPROVE_BUY" | "VETO",
  "direction": "long" | "short" | null,
  "headline": "max 12 words — specific level or catalyst",
  "thesis": "2 sentences — cite MTF + S/R + flow + news"
}`;

/** Largo-style desk question with pre-gathered tool context (no tool loop). */
const LARGO_DESK_PROMPT = `You are Largo, BlackOut's options desk analyst. Answer the user's question using ONLY the gathered desk data below. Be specific with levels and mechanics. 4-6 sentences, desk tone, no bullet lists.

USER QUESTION: "SPX is sitting under VWAP with negative gamma — should I fade the 6018 call wall or wait for a flush to 6004? What's the flow telling us?"

GATHERED DATA:
SPOT: 6012.25 (-0.18%) | VWAP: 6016.80 (below) | γ-flip: 6018.00 | regime: short_gamma
GEX WALLS 0DTE: 6025 call wall -$8.2M | 6018 flip -$4.1M | 6004 put wall +$5.6M
FLOW 0DTE: calls $42M vs puts $68M (put-skew 1.62) | net premium velocity: accelerating lower
TAPE: 6010P sweeps $4.2M, 6020C blocks $900k (hedging?) | dark pool bias: sell | NOPE: -0.42
INTERNALS: TICK -420, TRIN 1.18, ADD -890 | tide: bearish
CONFLUENCE: grade B+ short bias, entry 6010 stop 6019.50 target 5998 — 1 conflict (VIX low, expansion risk)
MACRO: FOMC minutes 14:00 ET today`;

type Scenario = {
  id: string;
  label: string;
  surface: string;
  productionModel: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  temperature: number;
};

function formatGexContext(ticker: string, hm: GexHeatmap): string {
  const g = hm.gex;
  const flip = g.flip ?? g.regime?.flip ?? null;
  const posture = g.regime?.posture ?? "n/a";
  const callWall = g.call_wall ?? null;
  const putWall = g.put_wall ?? null;
  const netGex = g.total ?? 0;
  return [
    `Ticker: ${ticker} | Spot: ${hm.spot} (${hm.change_pct >= 0 ? "+" : ""}${hm.change_pct.toFixed(2)}%) | asof ${hm.asof}`,
    `Gamma regime: ${posture} | flip ${flip ?? "n/a"} | max-pain ${hm.max_pain ?? "n/a"}`,
    `Call wall ${callWall ?? "n/a"} | Put wall ${putWall ?? "n/a"} | Net GEX ${netGex}`,
    `Regime read: ${g.regime?.read ?? "n/a"}`,
    `Shift (intraday): ${hm.shift?.available ? hm.shift.summary ?? "available" : "collecting"}`,
  ].join("\n");
}

/** Static NVDA GEX fallback when Polygon is cold (shape matches live context block). */
const GEX_FIXTURE = `Ticker: NVDA | Spot: 142.05 (-1.24%) | asof 2026-06-30T19:45:00Z
Gamma regime: short | flip 142.50 | max-pain 140.00
Call wall 150.00 | Put wall 140.00 | Net GEX -42000000
Regime read: Spot below gamma flip — dealers short gamma, dips can accelerate toward put wall 140
Shift (intraday): Put wall 140 building +$8M since open; flip drifted down from 144.00`;

async function buildGexScenario(): Promise<Scenario> {
  const ticker = "NVDA";
  let context = GEX_FIXTURE;
  let labelSuffix = "fixture";
  try {
    const hm = await fetchGexHeatmap(ticker);
    if (hm && hm.strikes.length > 0) {
      context = formatGexContext(ticker, hm);
      labelSuffix = "live Polygon data";
    }
  } catch (e) {
    console.warn("[eval] GEX live fetch failed, using fixture:", e instanceof Error ? e.message : e);
  }
  const prompt =
    `Dealer positioning snapshot for ${ticker}:\n\n${context}\n\n` +
    `Give the desk read now (3-5 sentences, market-structure analysis only).`;
  return {
    id: "gex-explain",
    label: `GEX heatmap explain (${ticker}, ${labelSuffix})`,
    surface: "GEX heatmap Largo read — highest-frequency shared AI call",
    productionModel: SONNET,
    system: GEX_SYSTEM,
    prompt,
    maxTokens: 600,
    temperature: 0.3,
  };
}

function staticScenarios(): Scenario[] {
  return [
    {
      id: "nw-narrative",
      label: "Night's Watch position narrative (NVDA 145C TRIM)",
      surface: "Per-position hold/trim/sell prose — multi-signal synthesis",
      productionModel: SONNET,
      system: NW_SYSTEM,
      prompt: NW_CONTEXT,
      maxTokens: 300,
      temperature: 0.3,
    },
    {
      id: "spx-play-gate",
      label: "SPX 0DTE play gate (A- short, mixed flow checklist)",
      surface: "Trade approve/veto — real-money quality arbiter",
      productionModel: SONNET,
      prompt: SPX_GATE_PROMPT,
      maxTokens: 500,
      temperature: 0,
    },
    {
      id: "largo-desk-qa",
      label: "Largo desk Q&A (pre-gathered SPX context, no tools)",
      surface: "Largo-style reasoning users ask most on the desk",
      productionModel: SONNET,
      prompt: LARGO_DESK_PROMPT,
      maxTokens: 450,
      temperature: 0.3,
    },
  ];
}

async function callModel(
  client: Anthropic,
  model: string,
  scenario: Scenario
): Promise<{ text: string; ms: number; input: number; output: number }> {
  const start = Date.now();
  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: scenario.maxTokens,
    messages: [{ role: "user", content: scenario.prompt }],
  };
  if (scenario.system) body.system = scenario.system;
  if (!modelRejectsSampling(scenario.temperature, model)) {
    body.temperature = scenario.temperature;
  }
  const res = await client.messages.create(body);
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    text,
    ms: Date.now() - start,
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
  };
}

function modelRejectsSampling(temp: number, model: string): boolean {
  return temp !== 0 && /claude-opus-4-(?:[7-9]|\d\d)|claude-fable/i.test(model);
}

function shortModel(m: string): string {
  return m.includes("sonnet") ? "Sonnet 4.6" : "Haiku 4.5";
}

function estCost(model: string, input: number, output: number): number {
  if (model.includes("haiku")) return (input * 1 + output * 5) / 1_000_000;
  return (input * 3 + output * 15) / 1_000_000;
}

async function main(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 });

  const gex = await buildGexScenario();
  const scenarios = [gex, ...staticScenarios()];

  console.log(`\n=== BlackOut AI tier eval: ${scenarios.length} scenarios × ${MODELS.length} models ===\n`);

  const results: Record<string, unknown> = {
    runAt: new Date().toISOString(),
    scenarios: [] as unknown[],
  };

  for (const scenario of scenarios) {
    console.log(`\n${"─".repeat(72)}`);
    console.log(`SCENARIO: ${scenario.label}`);
    console.log(`Surface: ${scenario.surface}`);
    console.log(`Production today: ${shortModel(scenario.productionModel)}`);
    console.log(`${"─".repeat(72)}`);

    const row: Record<string, unknown> = {
      id: scenario.id,
      label: scenario.label,
      surface: scenario.surface,
      productionModel: scenario.productionModel,
      responses: {} as Record<string, unknown>,
    };

    for (const model of MODELS) {
      process.stdout.write(`  Calling ${shortModel(model)}... `);
      try {
        const out = await callModel(client, model, scenario);
        const cost = estCost(model, out.input, out.output);
        (row.responses as Record<string, unknown>)[model] = {
          model: shortModel(model),
          latencyMs: out.ms,
          inputTokens: out.input,
          outputTokens: out.output,
          estCostUsd: Number(cost.toFixed(5)),
          text: out.text,
        };
        console.log(`${out.ms}ms | in=${out.input} out=${out.output} | ~$${cost.toFixed(4)}`);
        console.log(`\n  [${shortModel(model)}]\n${out.text.split("\n").map((l) => `    ${l}`).join("\n")}\n`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        (row.responses as Record<string, unknown>)[model] = { error: msg };
        console.log(`ERROR: ${msg}`);
      }
    }
    (results.scenarios as unknown[]).push(row);
  }

  const outPath = new URL("./ai-model-tier-eval-results.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull JSON written to ${outPath.pathname}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
