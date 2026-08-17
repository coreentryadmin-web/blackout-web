/**
 * Which desk panels to screenshot for an X post — mirrors x-showcase-post.mjs policy:
 * ticker-scoped, SPX-only surfaces never on non-SPX posts, max 4 attachments.
 */

export type XPostMediaAttachment = {
  /** Public desk name (Vector, Helix, Thermal, …). */
  tool: string;
  /** One-line label for the collage caption. */
  label: string;
  /** In-app path to open before screenshot. */
  deskPath: string;
  /** What region to capture (human operator or showcase script). */
  captureHint: string;
  order: number;
  /** Primary hero panel when building a collage. */
  primary?: boolean;
};

import type { SocialContentArchetype } from "@/lib/largo/social-content-core";

export type XPostMediaPlanInput = {
  ticker?: string | null;
  answer: string;
  question?: string | null;
  archetype?: SocialContentArchetype;
};

const ARCHETYPE_STACK: Partial<Record<SocialContentArchetype, string[]>> = {
  win_recap: ["nighthawk", "helix", "thermal", "vector"],
  play_evolution: ["nighthawk", "helix", "thermal", "vector"],
  platform_showcase: ["vector", "helix", "thermal", "slayer"],
  track_record: ["nighthawk", "vector", "helix"],
  morning_hook: ["nighthawk", "vector", "thermal"],
  live_desk: ["vector", "helix", "thermal", "slayer"],
};

const TOOL_SIGNALS: ReadonlyArray<{
  id: string;
  tool: string;
  re: RegExp;
  weight: number;
  spxOnly?: boolean;
}> = [
  { id: "helix", tool: "Helix", re: /\b(flow|helix|print|sweep|tape|premium|whale|dark pool)\b/i, weight: 3 },
  { id: "thermal", tool: "Thermal", re: /\b(gex|vex|dex|thermal|heatmap|matrix|dealer|gamma|wall|flip|magnet|max pain)\b/i, weight: 3 },
  { id: "vector", tool: "Vector", re: /\b(vector|bead|ladder|candle|intraday chart|0dte chart)\b/i, weight: 2 },
  { id: "slayer", tool: "SPX Slayer", re: /\b(spx slayer|confluence|play engine|gate|slayer|spx play)\b/i, weight: 3, spxOnly: true },
  { id: "nighthawk", tool: "Night Hawk", re: /\b(night hawk|0dte command|zerodte board|committed plan|playbook)\b/i, weight: 3 },
  { id: "largo", tool: "Largo", re: /\b(largo|desk read|ai terminal)\b/i, weight: 1 },
  { id: "meridian", tool: "Meridian", re: /\b(earnings|meridian|macro|opex|catalyst calendar)\b/i, weight: 2 },
];

function normalizeTicker(raw?: string | null): string {
  const t = String(raw ?? "SPX").trim().toUpperCase();
  if (t === "SPXW") return "SPX";
  return t || "SPX";
}

function isSpxTicker(ticker: string): boolean {
  return ticker === "SPX" || ticker === "SPXW";
}

function scoreTools(text: string, spx: boolean): Map<string, number> {
  const scores = new Map<string, number>();
  for (const sig of TOOL_SIGNALS) {
    if (sig.spxOnly && !spx) continue;
    if (sig.re.test(text)) {
      scores.set(sig.id, (scores.get(sig.id) ?? 0) + sig.weight);
    }
  }
  return scores;
}

function attachmentFor(
  id: string,
  ticker: string,
  order: number,
  primary?: boolean,
): XPostMediaAttachment | null {
  const sym = ticker;
  switch (id) {
    case "vector":
      return {
        tool: "Vector",
        label: `${sym} · 0DTE beads + flip`,
        deskPath: `/vector?ticker=${encodeURIComponent(sym)}`,
        captureHint:
          "Open Vector, select 0DTE + 15m timeframe, screenshot `.vector-chart-wrap` (walls + beads visible).",
        order,
        primary,
      };
    case "helix":
      return {
        tool: "Helix",
        label: `${sym} · flow tape`,
        deskPath: "/flows",
        captureHint:
          `Filter #helix-ticker-search to ${sym}, wait until tape rows match, screenshot the flow desk panel.`,
        order,
        primary,
      };
    case "thermal":
      return {
        tool: "Thermal",
        label: `${sym} · GEX matrix`,
        deskPath: "/heatmap",
        captureHint:
          `Search the ticker combobox for ${sym} (page boots SPY), screenshot \`.gex-heatmap-desk\`.`,
        order,
        primary,
      };
    case "slayer":
      return {
        tool: "SPX Slayer",
        label: "SPX · play engine + matrix rail",
        deskPath: "/dashboard",
        captureHint:
          "Full SPX Slayer desk — left GEX matrix rail + center play engine with live phase/grade.",
        order,
        primary,
      };
    case "nighthawk":
      return {
        tool: "Night Hawk",
        label: `${sym} · 0DTE Command`,
        deskPath: "/nighthawk",
        captureHint:
          sym === "SPX"
            ? "Night Hawk overview or 0DTE Command column with today's committed plans."
            : `0DTE Command card for ${sym} — expand the play row before capture.`,
        order,
        primary,
      };
    case "largo":
      return {
        tool: "Largo",
        label: `${sym} · desk read`,
        deskPath: "/terminal",
        captureHint:
          `Ask Largo about ${sym}, screenshot the answer card (verdict + levels rail).`,
        order,
        primary,
      };
    case "meridian":
      return {
        tool: "Meridian",
        label: `${sym} · catalyst intel`,
        deskPath: "/meridian",
        captureHint:
          `Open Meridian, search ${sym}, screenshot earnings/macro detail with live signal grid.`,
        order,
        primary,
      };
    case "track_record":
      return {
        tool: "Track Record",
        label: "Graded outcomes · public record",
        deskPath: "/track-record",
        captureHint:
          "Track record page with graded win/loss stats visible — only if the post cites grades.",
        order,
        primary,
      };
    default:
      return null;
  }
}

/** Default showcase stack when the answer doesn't strongly favor one panel. */
function defaultStack(spx: boolean): string[] {
  return spx
    ? ["vector", "helix", "thermal", "slayer"]
    : ["vector", "helix", "thermal", "largo"];
}

const MAX_ATTACHMENTS = 4;

/**
 * Recommend desk screenshots to attach — grounded in answer themes + ticker scope.
 * Does NOT capture or upload images; tells the operator WHAT to grab and WHERE.
 */
export function buildXPostMediaPlan(input: XPostMediaPlanInput): XPostMediaAttachment[] {
  const ticker = normalizeTicker(input.ticker);
  const spx = isSpxTicker(ticker);
  const corpus = `${input.question ?? ""}\n${input.answer}`.trim();
  const scores = scoreTools(corpus, spx);

  let ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const archetypeStack = input.archetype ? ARCHETYPE_STACK[input.archetype] : null;
  if (archetypeStack?.length) {
    ranked = [...archetypeStack, ...ranked];
  }

  if (ranked.length === 0) {
    ranked = defaultStack(spx);
  } else {
    const base = defaultStack(spx);
    for (const id of base) {
      if (!ranked.includes(id)) ranked.push(id);
    }
  }

  if (input.archetype === "track_record" && !ranked.includes("track_record")) {
    ranked.unshift("track_record");
  }

  // Non-SPX: strip SPX-only slayer unless explicitly about SPX
  if (!spx) {
    ranked = ranked.filter((id) => id !== "slayer");
  }

  // Dedupe while preserving order; cap at 4 for X carousel.
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const id of ranked) {
    if (seen.has(id)) continue;
    seen.add(id);
    picked.push(id);
    if (picked.length >= MAX_ATTACHMENTS) break;
  }

  return picked
    .map((id, idx) => attachmentFor(id, ticker, idx + 1, idx === 0))
    .filter((a): a is XPostMediaAttachment => a != null);
}

export function formatMediaPlanForClipboard(
  attachments: XPostMediaAttachment[],
): string {
  if (!attachments.length) return "";
  const lines = attachments.map(
    (a) =>
      `${a.order}. ${a.tool} — ${a.deskPath}\n   ${a.captureHint}`,
  );
  return `\n\nAttach (${attachments.length} image${attachments.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}
