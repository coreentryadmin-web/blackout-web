/**
 * Night Hawk Legacy Signal Intelligence — automatic daily learning digest (operator priority #15:
 * "automatic post-market learning report -- right/wrong calls, rejected winners, avoided losers,
 * filter attribution, proposed calibration changes").
 *
 * WHAT THIS CLOSES: debrief-aggregate.ts's `analyzeNighthawkDebriefs`/`buildNighthawkDebriefReport`
 * already computes essentially everything item #15 asks for (per-play failure-mode tagging,
 * pulled-by-rule attribution, gate-blocked-value counterfactuals, an improvement queue) -- it was
 * just never AUTOMATIC. It was reachable only via an admin-gated on-demand route
 * (GET /api/admin/nighthawk/analytics), so nothing ever ran it unprompted or delivered it
 * anywhere. This module is the missing "automatic" half: a pure formatter that turns one day's
 * `NighthawkDebriefReport` into a compact ops-Discord message, wired into the ALREADY-FIRING
 * nighthawk-outcomes cron (its own post-close 16:30 ET window) rather than a new schedule --
 * same low-risk "piggyback on an existing window-gated cron" choice already used for the
 * candidate-leaderboard/R-multiple work earlier today, not a new recurring load.
 *
 * PURE, no I/O, no Discord client here -- returns the message shape the caller passes to
 * notifyOpsDiscord (spx-play-notify.ts), same separation debrief-aggregate.ts's other pure
 * analyzers already keep from their own DB-reading wrapper (`buildNighthawkDebriefReport`).
 */

import type { NighthawkDebriefReport } from "./debrief-aggregate";

export type DailyLearningDigestField = { name: string; value: string };

export type DailyLearningDigestMessage = {
  title: string;
  body: string;
  fields: DailyLearningDigestField[];
};

const TOP_FAILURE_MODES_SHOWN = 3;
const TOP_IMPROVEMENT_ITEMS_SHOWN = 3;
const TOP_BLOCKED_VALUE_LINES_SHOWN = 2;

/**
 * `report.available === false` means the report ran over empty/unreachable input (DB down, or a
 * genuinely quiet window with nothing graded) -- posting a digest in that case would read as "here
 * is today's learning" when there is nothing real to say, so this returns null rather than a
 * misleadingly-empty message. The caller is expected to skip the notify entirely on null, not
 * post a placeholder.
 */
export function buildDailyLearningDigestMessage(
  report: NighthawkDebriefReport
): DailyLearningDigestMessage | null {
  if (!report.available) return null;

  const { summary, gate_validation, improvement_queue } = report;
  const lowNBadge = summary.low_n ? " (LOW-N — read with caution, not yet a record)" : "";

  const topModes = summary.failure_modes
    .slice(0, TOP_FAILURE_MODES_SHOWN)
    .map((f) => `${f.tag} (${f.n})`)
    .join(", ");

  const bodyParts = [
    `${summary.graded} graded, ${summary.debriefed} debriefed across ${summary.sessions} session(s) in the window${lowNBadge}.`,
  ];
  if (topModes) bodyParts.push(`Top failure mode(s): ${topModes}.`);
  if (summary.unpinned > 0) bodyParts.push(`${summary.unpinned} graded row(s) not yet debriefed.`);

  const fields: DailyLearningDigestField[] = [];

  if (improvement_queue.length) {
    const top = improvement_queue.slice(0, TOP_IMPROVEMENT_ITEMS_SHOWN);
    fields.push({
      name: `Improvement queue (${improvement_queue.length} item(s))`,
      value: top
        .map((item) => {
          const n = `n=${item.evidence.n}${item.evidence.delta != null ? `, delta=${item.evidence.delta}pt` : ""}`;
          const badge = item.low_n ? " [low-n]" : "";
          return `- ${item.signal} (${n})${badge}${item.suggestion ? `: ${item.suggestion}` : ""}`;
        })
        .join("\n"),
    });
  }

  const blockedLines = gate_validation.blocked_value
    .filter((l) => l.would_have_won_rate_pct != null)
    .slice(0, TOP_BLOCKED_VALUE_LINES_SHOWN);
  if (blockedLines.length) {
    fields.push({
      name: "Gate-blocked value (rejected winners)",
      value: blockedLines.map((l) => `- ${l.summary}`).join("\n"),
    });
  }

  return {
    title: `Night Hawk Legacy — Daily Learning Digest (${report.window.through})`,
    body: bodyParts.join(" "),
    fields,
  };
}
