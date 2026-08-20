/**
 * SPX Slayer Largo audit scoring — submodule tool overlap, topic coverage, tone, honesty.
 */
import { toneIssues, honestyIssues } from "../../src/lib/bie/professional-tone.ts";

const VENDOR_RE = /\b(polygon|unusual whales|anthropic|clerk|redis|postgres|aws)\b/i;
const PREFETCH_TOOLS = new Set([
  "live_feed_capture",
  "desk_prefetch_spx",
  "platform_vitals_prefetch",
  "bie_platform_context",
]);

/** Claude tool names that satisfy submodule grounding (excluding prefetch-only). */
export function isDataTool(name) {
  const n = String(name ?? "");
  return n.startsWith("get_") || n === "blackout_intelligence";
}

export function hasGroundedAnswer(answer) {
  return (
    /\[\s*fact\s*\]/i.test(answer) ||
    /\b\d{1,2},\d{3}\.\d{2}\b/.test(answer) ||
    /\b\d{4,5}(\.\d+)?\b/.test(answer)
  );
}

/** Submodule → keywords the answer should touch (at least one). */
export const SUBMODULE_TOPIC = {
  play: /\b(phase|action|grade|play|invalidation|engine)\b/i,
  gex: /\b(flip|wall|gamma|gex|strike|regime|king)\b/i,
  pulse: /\b(pulse|flip|magnet|macro|wall|event|cross|shift)\b/i,
  pin: /\b(pin|magnet|close|eod|fade|wall|cone|projected)\b/i,
  gates: /\b(gate|pass|fail|block|checklist|trace)\b/i,
  lotto: /\b(lotto|runner|multi.?day|3\s*dte|weekly|0dte|play)\b/i,
  "power-hour": /\b(power hour|phase|direction|strike|level|close)\b/i,
  technicals: /\b(vwap|ema|structure|trend|session|level)\b/i,
  "signal-log": /\b(signal|log|committed|buy|sell|trim|open)\b/i,
  "engine-history": /\b(engine|snapshot|block|reject|scan|gate|history)\b/i,
  record: /\b(win rate|record|stats|graded|setup|expectancy)\b/i,
  internals: /\b(tick|trin|breadth|internals|add|support|conflict)\b/i,
  "flow-gex": /\b(flow|confluence|conflict|helix|gex|skew)\b/i,
  vector: /\b(vector|beads|structure|regime|chart|play card|slayer)\b/i,
};

export function toolOverlap(preferred, used) {
  const pref = new Set((preferred ?? []).map(String));
  const hit = (used ?? []).filter((t) => pref.has(String(t)));
  return { overlap: hit, ratio: pref.size ? hit.length / pref.size : 0 };
}

export function scoreSpxScenario(scenario, body, status, ms) {
  const issues = [];
  const answer = typeof body?.answer === "string" ? body.answer : "";
  const tools = body?.tools_used ?? [];

  if (status !== 200) {
    issues.push(`http-${status}`);
    return { verdict: "SKIP", issues, tools, answer_len: answer.length, ms };
  }
  if (!answer || answer.length < 20) issues.push("too-short");
  if (VENDOR_RE.test(answer)) issues.push("vendor-leak");
  if (body?.answer?.match(/\$?\d+\.\d{6,}/)) issues.push("float-noise");
  if (!body?.envelope && answer.length > 120) issues.push("no-envelope");
  if (body?.verification?.unverified?.length) {
    issues.push(`unverified-${body.verification.unverified.length}`);
  }
  if (ms > 95_000) issues.push("slow");

  if (scenario.requireTopic && !scenario.requireTopic.test(answer)) {
    issues.push("missed-topic");
  }
  if (scenario.submodule && SUBMODULE_TOPIC[scenario.submodule]) {
    if (!SUBMODULE_TOPIC[scenario.submodule].test(answer)) {
      issues.push(`submodule-topic-${scenario.submodule}`);
    }
  }
  if (scenario.preferredTools?.length) {
    const dataTools = tools.filter(isDataTool);
    const { overlap, ratio } = toolOverlap(scenario.preferredTools, dataTools.length ? dataTools : tools);
    const prefetchOnly = tools.length > 0 && tools.every((t) => PREFETCH_TOOLS.has(String(t)));
    if (overlap.length === 0 && !prefetchOnly && !hasGroundedAnswer(answer)) {
      issues.push("no-preferred-tool");
    } else if (overlap.length === 0 && prefetchOnly && !hasGroundedAnswer(answer)) {
      issues.push("prefetch-ungrounded");
    } else if (ratio < 0.25 && scenario.preferredTools.length >= 2 && dataTools.length >= 2) {
      issues.push("weak-tool-overlap");
    }
  }
  if (scenario.maxLen && answer.length > scenario.maxLen) {
    issues.push("too-long-for-concrete");
  }
  if (scenario.minLen && answer.length < scenario.minLen) {
    issues.push("too-short-for-deep");
  }

  for (const t of toneIssues(answer)) issues.push(`tone-${t}`);
  for (const h of honestyIssues(answer)) issues.push(`honesty-${h}`);

  const bad = issues.some(
    (i) =>
      i.startsWith("http-") ||
      i === "missed-topic" ||
      i.startsWith("submodule-topic-") ||
      i === "no-preferred-tool" ||
      i === "prefetch-ungrounded" ||
      i === "vendor-leak" ||
      i.startsWith("honesty-no-grounded")
  );
  const verdict = issues.length === 0 ? "PASS" : bad ? "FAIL" : "WARN";

  return { verdict, issues, tools, answer_len: answer.length, ms, preview: answer.slice(0, 400) };
}
