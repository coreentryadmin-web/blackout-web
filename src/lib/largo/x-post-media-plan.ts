/**
 * Which desk panels to screenshot for an X post — mirrors x-showcase-post.mjs policy:
 * ticker-scoped, SPX-only surfaces never on non-SPX posts, max 4 attachments.
 */

import type { SocialContentArchetype } from "@/lib/largo/social-content-core";
import {
  buildCapturePlaybook,
  wantsMag7Thermal,
  type CapturePlaybook,
} from "@/lib/largo/x-post-capture-playbook";
import { buildTickerSocialGuide } from "@/lib/largo/ticker-social-guide";

export type XPostMediaAttachment = {
  tool: string;
  label: string;
  deskPath: string;
  captureHint: string;
  order: number;
  primary?: boolean;
  /** Full babysitting steps for this panel. */
  steps: string[];
  screenshotTarget: string;
  verifyBeforeCapture: string;
};

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
  earnings_catalyst: ["meridian", "helix", "thermal", "vector"],
  ticker_post: ["vector", "helix", "thermal", "nighthawk"],
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
  archetype?: SocialContentArchetype,
  corpus?: string,
  primary?: boolean,
): XPostMediaAttachment | null {
  const useMag7 = id === "thermal" && corpus && wantsMag7Thermal(corpus);
  const playbook = buildCapturePlaybook({
    toolId: id,
    ticker,
    archetype,
    thermalPreset: useMag7 ? "mega" : null,
  });
  if (!playbook) return null;
  return {
    tool: playbook.tool,
    label: playbook.goal,
    deskPath: playbook.deskPath,
    captureHint: playbook.steps[playbook.steps.length - 1] ?? playbook.goal,
    order,
    primary,
    steps: playbook.steps,
    screenshotTarget: playbook.screenshotTarget,
    verifyBeforeCapture: playbook.verifyBeforeCapture,
  };
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

  if (input.archetype === "ticker_post" && input.ticker) {
    const guide = buildTickerSocialGuide({
      ticker,
      question: input.question,
      answer: input.answer,
      archetype: input.archetype,
      earningsSoon: /\b(earnings|meridian|catalyst|every applicable product)\b/i.test(corpus),
    });
    if (guide.essentialAttachments.length) {
      return guide.essentialAttachments.slice(0, MAX_ATTACHMENTS);
    }
  }

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
    .map((id, idx) =>
      attachmentFor(id, ticker, idx + 1, input.archetype, corpus, idx === 0),
    )
    .filter((a): a is XPostMediaAttachment => a != null);
}

export function formatMediaPlanForClipboard(
  attachments: XPostMediaAttachment[],
): string {
  if (!attachments.length) return "";
  const blocks = attachments.map((a) => {
    const stepLines = a.steps.map((s, i) => `   ${i + 1}. ${s}`).join("\n");
    return (
      `${a.order}. ${a.tool} — ${a.deskPath}\n` +
      `   Goal: ${a.label}\n` +
      `   Verify: ${a.verifyBeforeCapture}\n` +
      `${stepLines}\n` +
      `   → Screenshot: ${a.screenshotTarget}`
    );
  });
  return `\n\nScreenshot workflow (${attachments.length} panel${attachments.length === 1 ? "" : "s"} — attach best 4 on X):\n${blocks.join("\n\n")}`;
}
