import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import {
  nighthawkOutcomesRunHealth,
  resolvePendingNighthawkOutcomes,
  resolveBangerScaleOutGrades,
} from "@/features/nighthawk/lib/play-outcomes";
import { regradeStuckNighthawkOutcomes } from "@/features/nighthawk/lib/regrade-stuck";
import { gradeNighthawkCandidateForwardReturns } from "@/features/nighthawk/lib/candidate-forward-grade";
import {
  runNighthawkDebriefPass,
  runNighthawkRejectionCounterfactuals,
  type NighthawkDebriefPassResult,
  type NighthawkRejectionCfResult,
} from "@/features/nighthawk/lib/debrief-persist";
import { buildNighthawkDebriefReport } from "@/features/nighthawk/lib/debrief-aggregate";
import { buildDailyLearningDigestMessage } from "@/features/nighthawk/lib/daily-learning-digest";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { todayEt } from "@/lib/et-date";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function inOutcomeWindow(force: boolean): boolean {
  if (force) return true;
  // DST-aware window (America/New_York). The cron now fires at both 20:30 and
  // 21:30 UTC so 16:30 ET is hit in EDT and EST; this guard self-skips the off-band fire.
  return inEtWindow({
    targetHour: Number(process.env.NIGHTHAWK_OUTCOMES_HOUR_ET ?? "16"),
    targetMinute: Number(process.env.NIGHTHAWK_OUTCOMES_MINUTE_ET ?? "30"),
    catchupMin: Number(process.env.NIGHTHAWK_OUTCOMES_CATCHUP_MIN ?? "90"),
  });
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const force = req.nextUrl.searchParams.get("force") === "1";
  const sessionDay = todayEt(new Date(started));

  // Holiday guard: EventBridge is weekday-only and inEtWindow only knows Sat/Sun. On NYSE holidays
  // the 16:30 ET window still resolves and the route would grade/debrief against a closed tape.
  // force=1 bypasses for ops recovery (same pattern as nighthawk-morning-confirm / swing-discovery).
  if (!force && !isTradingDayEt(sessionDay)) {
    const payload = { ok: true, skipped: true, reason: `non-trading day (${sessionDay})` };
    await logCronRun("nighthawk-outcomes", started, payload);
    return NextResponse.json(payload);
  }

  if (!inOutcomeWindow(force)) {
    const payload = {
      ok: false,
      skipped: true,
      reason: "Outside outcome window (4:30 PM ET) — use ?force=1 to override",
    };
    await logCronRun("nighthawk-outcomes", started, payload);
    return NextResponse.json(payload);
  }

  try {
    // Guard against a non-numeric ?days override: Number("abc") → NaN, which would bind to
    // the $1::int SQL param and make Postgres throw "invalid input syntax for type integer".
    // Fall back to the 14-day default for anything non-finite or non-positive.
    const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "14");
    const lookbackDays = Number.isFinite(rawDays) && rawDays > 0 ? rawDays : 14;
    const result = await resolvePendingNighthawkOutcomes({ lookbackDays });
    // Cron honesty (PR-N1): per-row grade-write failures used to be tucked into
    // meta.errors under an unconditional ok:true — the H-1 constraint clobber failed
    // 12 grades for four straight days while cron-health stayed green. errors with
    // content ⇒ the run FAILED (health record + ops ping via logCronRun) and the HTTP
    // status says so too.
    const health = nighthawkOutcomesRunHealth(result);

    // PR-N10: the Debrief pass, strictly AFTER grading — pins the per-play post-mortem
    // onto newly-graded rows and counterfactually grades PR-N3's publish-gate-blocked
    // plays on the same daily-bar path. FAIL-SOFT BY CONTRACT: both passes report their
    // own honest ledgers in the payload/meta, but neither can fail the grading run —
    // `health` above (the run's ok + HTTP status) is computed from grading alone, and
    // the belt-and-suspenders catch here covers even a pass that throws unexpectedly.
    const nowMs = Date.now();
    const debrief: NighthawkDebriefPassResult = await runNighthawkDebriefPass({ nowMs }).catch((err) => ({
      ok: false,
      scanned: 0,
      pinned: 0,
      already_pinned: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));
    const rejectionCf: NighthawkRejectionCfResult = await runNighthawkRejectionCounterfactuals({
      nowMs,
    }).catch((err) => ({
      ok: false,
      scanned: 0,
      graded: 0,
      ungradeable: 0,
      skipped_no_bar: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));

    // PR-N1 follow-up: rows that aged past the resolver window stay `pending` forever
    // unless explicitly regraded. Fail-soft — never fail the grading run.
    const regradeStuck = await regradeStuckNighthawkOutcomes({ limit: 50 }).catch((err) => ({
      dry_run: false,
      matched: 0,
      regraded: 0,
      skipped_no_bar: 0,
      errors: [err instanceof Error ? err.message : String(err)],
      rows: [],
    }));

    // Step-6b: grade the whole-market BANGER population on the option scale-out basis and pin the grade
    // onto its outcome row (the evidence the nighthawk-side scale-out reader graduates the live managed
    // exit on). FAIL-SOFT BY CONTRACT, same as the debrief/rejection/regrade passes above: it reports its
    // own ledger but can NEVER fail the grading run — `health.ok` is computed from stock-outcome grading
    // alone, and this catch covers even an unexpected throw.
    const bangerScaleOut = await resolveBangerScaleOutGrades({ lookbackDays }).catch((err) => ({
      graded: 0,
      ungradeable: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }));

    // Phase 1.8 (Night Hawk Legacy Signal Intelligence): multi-horizon (5m/15m/30m/1h/EOD)
    // forward-return grading for every candidate_snapshot row (Phase 1.3-1.5's per-stage
    // capture), not just published plays. FAIL-SOFT BY CONTRACT, identical shape to the
    // debrief/rejection/regrade/banger passes above — never fails the headline grading run.
    const candidateForwardGrade = await gradeNighthawkCandidateForwardReturns({ lookbackDays }).catch(
      (err) => ({
        graded: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      })
    );

    // Night Hawk Legacy Signal Intelligence, Phase 2F part 1 (operator priority #15 — "automatic
    // post-market learning report"): debrief-aggregate.ts's analyzeNighthawkDebriefs already
    // computes everything the mandate asks for (failure-mode mix, pulled-by-rule attribution,
    // gate-blocked-value counterfactuals, an improvement queue) — it was only ever reachable via
    // an admin on-demand route. This makes it AUTOMATIC by piggybacking on this cron's own
    // already-firing post-close (16:30 ET) window rather than a new schedule — the same low-risk
    // "reuse an existing window" choice made for the candidate-leaderboard/R-multiple work earlier
    // today. `days: 1` scopes it to TODAY's session specifically (distinct from the admin route's
    // own 30-day default), matching "daily digest," not a rolling report. FAIL-SOFT BY CONTRACT,
    // identical shape to every other pass above — never fails the headline grading run, and a
    // digest-build/notify failure here can never mask a real grading failure.
    const dailyLearningDigest = await (async () => {
      try {
        const dailyReport = await buildNighthawkDebriefReport({ days: 1, nowMs });
        const message = buildDailyLearningDigestMessage(dailyReport);
        if (!message) return { posted: false, reason: "no debrief data available for today's session", errors: [] };
        const posted = await notifyOpsDiscord({
          title: message.title,
          body: message.body,
          severity: "info",
          fields: message.fields,
        });
        return { posted, reason: posted ? null : "notifyOpsDiscord returned false (webhook not configured?)", errors: [] };
      } catch (err) {
        return { posted: false, reason: null, errors: [err instanceof Error ? err.message : String(err)] };
      }
    })();

    const payload = {
      ok: health.ok,
      ...result,
      debrief,
      rejection_counterfactuals: rejectionCf,
      regrade_stuck: regradeStuck,
      banger_scale_out: bangerScaleOut,
      candidate_forward_grade: candidateForwardGrade,
      daily_learning_digest: dailyLearningDigest,
    };
    await logCronRun("nighthawk-outcomes", started, {
      ok: health.ok,
      error: health.error,
      resolved: result.resolved,
      skipped_count: result.skipped,
      errors: result.errors,
      debrief,
      rejection_counterfactuals: rejectionCf,
      regrade_stuck: regradeStuck,
      banger_scale_out: bangerScaleOut,
      candidate_forward_grade: candidateForwardGrade,
      daily_learning_digest: dailyLearningDigest,
    });
    return NextResponse.json(payload, health.ok ? undefined : { status: 500 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/nighthawk-outcomes]", error);
    await logCronRun("nighthawk-outcomes", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Outcome resolution failed" }, { status: 500 });
  }
}
