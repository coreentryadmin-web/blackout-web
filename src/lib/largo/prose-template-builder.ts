/**
 * PROSE TEMPLATE BUILDER — narrative framing for phase 2b answers.
 *
 * Components (visual-component-builder) are JSON—structural, data-driven, rendered.
 * Prose templates are DIRECTIVES—how to narrate around those components, scaled by depth.
 *
 * This module generates the PROSE STRUCTURE that wraps components:
 * ```
 * <component: header>
 *
 * <PROSE: Verdict section>
 *
 * <component: comparison>
 * <component: evidence>
 *
 * <PROSE: Interpretation section>
 *
 * <component: risk>
 * <PROSE: Risk narrative>
 *
 * <PROSE: Data section>
 * ```
 *
 * Depth scaling:
 * - minimal: one-line verdict, no elaboration
 * - standard: verdict + facts + interpretation + data (4 sections)
 * - deep: standard + risk + precedent detail
 * - institutional: deep + regime/macro context, multi-session precedent
 */

import type { IntentCategory } from "./intent-classifier";
import type { ResponseDepth } from "./adaptive-response-orchestrator";
import type { ConsensusMatrix } from "./consensus-read-extract";
import type { DeskReadDecision } from "./desk-read-decision";

export interface ProseTemplate {
  /** Section heading (e.g. "Verdict", "Facts", "Risk") */
  section: string;
  /** Instruction to the model for this section */
  directive: string;
  /** How much elaboration is warranted at this depth */
  depthScaling: {
    minimal?: string;
    standard?: string;
    deep?: string;
    institutional?: string;
  };
}

/**
 * Get prose templates for an intent category at a given depth.
 * Returns array of section directives in order.
 */
export function getProseSectionsForIntent(
  category: IntentCategory,
  depth: ResponseDepth,
  context?: { consensus?: ConsensusMatrix; deskRead?: DeskReadDecision }
): ProseTemplate[] {
  const sections: ProseTemplate[] = [];

  switch (category) {
    case "QUICK_FACT":
      // Minimal only: one-liner
      sections.push({
        section: "Verdict",
        directive: "Answer in one sentence. No sections, no elaboration. The fact itself.",
        depthScaling: {
          minimal: "One sentence that directly answers the question.",
        },
      });
      break;

    case "LEVEL_STRUCTURE":
      // Facts-only: walls and technicals
      sections.push({
        section: "Verdict",
        directive:
          "State the primary wall or structure in one line: its location, kind (support/resistance/pivot), and the regime it defines.",
        depthScaling: {
          minimal: "One line: wall location and kind.",
          standard: "One line: wall location, kind, and why it matters now.",
        },
      });

      if (depth !== "minimal") {
        sections.push({
          section: "Facts",
          directive:
            "Describe price structure context: prior breakdown levels, regime-defining walls, technical support/resistance. No narrative — just the state.",
          depthScaling: {
            standard:
              "List floor, gate (entry), king (target) with distances from spot. Anchors from: prior bounces, volume clusters, options gamma walls, regime anchors.",
            deep: "Same, plus temporal: which levels were tested when, how many times, confidence in each. Reference session numbers or dates.",
            institutional:
              "Same, plus multi-regime history: how this structure emerged, regime-shift anchors, what broke prior structure, edge cases where this level failed.",
          },
        });
      }
      break;

    case "FLOW":
      // Tape analysis: no narrative gaps
      sections.push({
        section: "Verdict",
        directive: "One-line market participant signal: whose order flow is dominant now.",
        depthScaling: {
          minimal: "One line: primary flow signal (e.g. 'call stacking' or 'dark pool buying').",
          standard: "One line with a single contrarian note if material.",
        },
      });

      sections.push({
        section: "Facts",
        directive:
          "Flow signal, print count, dark pool reads, time-of-day anchors. Each MUST be quantified or timestamped. Do NOT fill sparse flow with narrative — say 'flow light, tools to follow' instead.",
        depthScaling: {
          minimal: "Tape observation in one line. If sparse, say so.",
          standard:
            "Signal + volume cohort + time window. If tools came back empty, THAT is the answer: 'No prints tracked in the last 15 min' not 'presumably quiet'.",
          deep: "Signal + magnitude + venue/route + freshness. Contrast with prior hour or session.",
        },
      });
      break;

    case "MARKET_READ":
      // Consensus across systems
      sections.push({
        section: "Verdict",
        directive:
          "State the consensus direction and confidence in one line. Omit if conflicted — go straight to Facts.",
        depthScaling: {
          minimal: context?.consensus?.agreement.direction
            ? `${context.consensus.agreement.direction} on ${context.consensus.agreement.voting} systems consulted.`
            : "Systems disagree.",
          standard: `${context?.consensus?.agreement.direction || "Mixed signals"} — ${context?.consensus?.agreement.voting || 0} systems. ${
            context?.consensus?.agreement.averageStrength || 5
          }/10 strength.`,
        },
      });

      sections.push({
        section: "Facts",
        directive:
          "Show the consensus matrix: which systems agree, which conflict, their reasoning and strength. Never reconcile disagreements — surface them so the reader decides.",
        depthScaling: {
          standard:
            "List each system: direction, basis, strength. If conflicts exist, state them without picking a winner.",
          deep: "Same, plus evidence: specific data each system cited. Freshness: is this data live or cached.",
          institutional:
            "Same, plus regime: have these systems typically align on this ticker, or is disagreement the norm here. Reference prior consensus patterns.",
        },
      });

      sections.push({
        section: "Interpretation",
        directive:
          "Narrow focus: what is the material disagreement (if any), and what would resolve it. Do NOT synthesize a single answer.",
        depthScaling: {
          standard:
            "One observation: what each side of a disagreement is watching. What data would change their read.",
          deep: "Same, plus timing: is one system ahead of the other, or is this a genuine conflict.",
        },
      });

      sections.push({
        section: "Data",
        directive: "State the freshness and sources: live, 1-min lag, session close. Any gaps in coverage.",
        depthScaling: {
          standard: "Freshness: live data, cached as of timestamp, or sparse.",
        },
      });
      break;

    case "COMPARISON":
      // Consensus, but multi-ticker
      sections.push({
        section: "Verdict",
        directive: "Which instrument is strongest, which weakest, on a single axis (directional, volatility, conviction).",
        depthScaling: {
          standard: "Ranking: A > B > C by the chosen lens.",
        },
      });

      sections.push({
        section: "Facts",
        directive: "Consensus per instrument: direction, strength, basis. Show the comparison side-by-side.",
        depthScaling: {
          standard: "Table or list format: each ticker, consensus direction, strength, key driver.",
          deep: "Same, plus why they diverge: regime differences, volatility regime, implied moves.",
        },
      });
      break;

    case "TRADE_INTENT":
      // Decision hierarchy: PLAY/WAIT/NO_TRADE
      sections.push({
        section: "Verdict",
        directive:
          context?.deskRead?.state === "PLAY"
            ? "🟢 ENTER at trigger. Thesis, confidence, no caveats."
            : context?.deskRead?.state === "WAIT"
              ? "🟡 WAIT FOR TRIGGER. What must happen for conviction to rise."
              : "🔴 STAND ASIDE. Why conviction is insufficient.",
        depthScaling: {
          minimal:
            context?.deskRead?.state === "PLAY"
              ? `🟢 ENTER — ${context.deskRead.thesis}`
              : context?.deskRead?.state === "WAIT"
                ? `🟡 WAIT — ${context.deskRead?.trigger || "clarity needed"}`
                : "🔴 STAND ASIDE",
          standard: `${context?.deskRead?.headline || "Decision"} (${Math.round((context?.deskRead?.confidence || 0) * 100)}% confidence)`,
        },
      });

      sections.push({
        section: "Facts",
        directive:
          "Consensus: which systems are bullish, which bearish, how strong. Structural support: regime, levels, gamma regime.",
        depthScaling: {
          standard:
            "Consensus matrix (systems and strength) + key level (support for PLAY, resistance for WAIT/NO_TRADE).",
          deep: "Same, plus regime anchor: dealer gamma, volatility regime, time-of-day anchors that support or threaten the thesis.",
        },
      });

      if (context?.deskRead?.state === "PLAY") {
        sections.push({
          section: "Thesis",
          directive: "Why this play now: the confluence of flow, structure, and regime that creates conviction.",
          depthScaling: {
            standard: "Flow signal + structural support + regime alignment in one paragraph.",
            deep: "Same, plus what BREAKS it: the exact fill level or time that invalidates.",
          },
        });

        sections.push({
          section: "Trigger",
          directive: "Entry signal: the exact condition that converts waiting into entering.",
          depthScaling: {
            standard: "Price level, time window, or fill condition.",
            deep: "Same, plus why that trigger: what it signals about regime or flow.",
          },
        });

        sections.push({
          section: "Invalidation",
          directive: "The ONE close-of-business condition that kills the thesis. Not 'if it breaks support' — the exact level.",
          depthScaling: {
            standard: "Price level or time boundary.",
            deep: "Same, plus P&L at that level if the trade went wrong.",
          },
        });
      } else if (context?.deskRead?.state === "WAIT") {
        sections.push({
          section: "Gate",
          directive:
            "What must resolve for WAIT to become PLAY. Specific, measurable, not vague ('more conviction').",
          depthScaling: {
            standard:
              "The exact price level, news event, or data point that would change conviction. Trigger: what confirms.",
            deep: "Same, plus timing: when this gate closes (end of session, earnings, Fed announcement).",
          },
        });
      } else {
        // NO_TRADE
        sections.push({
          section: "Missing",
          directive: "Why conviction fails. Not 'mixed signals' — the specific missing evidence or contradictory signal.",
          depthScaling: {
            standard: context?.deskRead?.missingEvidence
              ? context.deskRead.missingEvidence.join("; ")
              : "Insufficient conviction.",
            deep: "What would change this: what specific data or event would raise conviction above 60%.",
          },
        });
      }

      if (depth !== "minimal") {
        sections.push({
          section: "Risk",
          directive: `If the play breaks, how: what is the invalidation, and what does it cost.`,
          depthScaling: {
            standard: `Invalidation level: ${context?.deskRead?.invalidation || "TBD"}.`,
            deep: `Invalidation level + P&L at that level if this was a real position. The worst case, quantified.`,
          },
        });
      }
      break;

    case "VALIDATION":
      // Trade outcome grading: real fills, no fiction
      sections.push({
        section: "Verdict",
        directive: "Win, loss, or breakeven. The exact filled price and exit, not approximations.",
        depthScaling: {
          minimal: "Win/loss/breakeven + realized P&L.",
          standard: "Entry fill, exit fill, P&L. Time in trade.",
        },
      });

      sections.push({
        section: "Facts",
        directive:
          "Where the entry actually filled, where the exit actually filled. Timestamps. Do NOT invent fills — if the order never traded, say so.",
        depthScaling: {
          standard: "Entry timestamp + price + qty, exit timestamp + price + qty. Mid-session action if any.",
          deep: "Same, plus why that exit: did it hit the stop, the target, or was it time-based.",
        },
      });
      break;

    case "WHY":
      // Root cause of an outcome
      sections.push({
        section: "Verdict",
        directive:
          "Root cause: where did the thesis break. Market cause (regime shifted, level broke) or execution cause (filled wrong, stopped early).",
        depthScaling: {
          standard:
            "One-line root: 'dealer gamma flipped when QQQ broke 450' or 'filled 0.15 worse than mid'.",
        },
      });

      sections.push({
        section: "Root Cause",
        directive:
          "The exact market condition or execution fact that caused the loss. Root lives in MARKET or EXECUTION, never in 'bad luck'.",
        depthScaling: {
          standard: "Market cause: regime shift, gamma regime, level break, time factor. OR execution cause: venue, timing, size.",
          deep: "Same, plus timeline: when the break happened, what warned it, whether it was foreseeable.",
          institutional:
            "Same, plus precedent: has this regime shift happened before on this ticker, what was the recovery, is it repeating.",
        },
      });

      sections.push({
        section: "Evidence",
        directive:
          "The data that points to this root cause. Not post-hoc narrative — the observable signal that predicted or confirmed it.",
        depthScaling: {
          standard: "Flow signal, level break, gamma regime, print data—whatever SHOWED this was happening.",
          deep: "Same, plus timeline: the specific minute or print that signaled the break.",
        },
      });

      sections.push({
        section: "Precedent",
        directive: "Has this exact cause happened before. On this ticker, this regime, this strategy.",
        depthScaling: {
          standard: "One prior session with the same break pattern.",
          deep: "Multiple sessions, frequency, recovery time.",
          institutional:
            "Pattern across regime: is this a known regime signature, typical recovery, or a new twist.",
        },
      });
      break;

    case "CHANGE_DETECTION":
    case "FLOW":
    default:
      sections.push({
        section: "Observation",
        directive: "State what changed and when. Be explicit: timestamp, what metric, before/after values.",
        depthScaling: {
          minimal: "One-line change.",
          standard: "Timestamp + metric + before/after.",
        },
      });
      break;
  }

  return sections;
}

/**
 * Format prose sections as a numbered list with depth-specific directives.
 * This is the OUTPUT that gets inserted into the system prompt or appended to the response.
 */
export function formatProseDirectives(
  sections: ProseTemplate[],
  depth: ResponseDepth
): string {
  if (!sections.length) return "";

  const lines: string[] = [];
  lines.push("## Prose Structure\n");

  sections.forEach((section, i) => {
    lines.push(`${i + 1}. **${section.section}**`);

    const depthText = section.depthScaling[depth] || section.depthScaling.standard || "Omit if no content.";
    lines.push(`   ${section.directive}`);
    if (depthText) {
      lines.push(`   → ${depth}: ${depthText}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}
