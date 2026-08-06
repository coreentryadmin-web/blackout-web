import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { requireDatabaseInProduction, fetchNighthawkJob, failStaleNighthawkJobs } from "@/lib/db";
import { buildEveningEdition, serializeBuildError } from "@/features/nighthawk/lib/edition-builder";
import { isInEditionWindow } from "@/features/nighthawk/lib/edition-stale";
import { nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";

const CRON_KEY = "nighthawk-playbook";

export const dynamic = "force-dynamic";
// INERT on this deploy target, kept only as documentation of intent. `next.config.mjs` sets
// `output: "standalone"` and we run on ECS, so `maxDuration` is a Vercel-only construct with zero
// runtime references in the built server (verified against the pinned Next 15.5.19). Nothing
// in-process caps this handler; the only real deadline is the ALB's `idle_timeout` (120s), and the
// cron Lambda that invokes us gives up even sooner at ~60s. See the ALB 504 entry in
// docs/audit/FINDINGS.md.
//
// There is NO `BUILD_TIME_BUDGET_MS` guard — an earlier version of this comment claimed one
// "ALWAYS checkpoints … BEFORE the host can kill us, so partial progress is never lost". That
// constant has never existed anywhere in the codebase, and the claim was load-bearing in the wrong
// direction: it invited raising this number instead of relying on the mechanism that actually
// protects the build.
//
// What DOES protect it is stage-level checkpointing in the builder, not a wall-clock timer:
// `buildEveningEdition` persists `current_stage` to `nighthawk_jobs` as it advances
// (`stage_context` → `stage_dossiers` → `published`), `fetchStagedDossierTickers` narrows
// `remaining` on the way back in, and the next invocation (cron or `?force=1`) resumes from the
// last committed stage. `failStaleNighthawkJobs()` reaps rows abandoned mid-flight. Crucially the
// handler hands the build to `after()` and returns 202 in well under 60s, so the Lambda hanging up
// does not abort it — the work continues server-side and publishes on its own.
export const maxDuration = 800;

function editionEnabled(): boolean {
  const flag = process.env.NIGHTHAWK_EDITION_ENABLED?.trim();
  return flag !== "0" && flag !== "false";
}

function inEditionWindow(force: boolean): boolean {
  if (force) return true;
  return isInEditionWindow();
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  if (!editionEnabled()) {
    const payload = { ok: false, skipped: true, reason: "NIGHTHAWK_EDITION_ENABLED=0" };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const statusOnly = req.nextUrl.searchParams.get("status") === "1";
  const persist = req.nextUrl.searchParams.get("persist") === "1";
  const asOfEtParam = req.nextUrl.searchParams.get("asOfEt")?.trim() || null;
  const editionForParam = req.nextUrl.searchParams.get("edition_for")?.trim() || null;
  // Use ET date explicitly so the edition target doesn't flip at UTC midnight.
  const todayInEt = todayEt();
  const sessionEt = asOfEtParam ?? todayInEt;
  const editionFor = editionForParam ?? nextTradingDayEt(sessionEt);
  const job = await fetchNighthawkJob(editionFor);

  if (statusOnly) {
    return NextResponse.json({
      ok: true,
      edition_for: editionFor,
      job_status: job?.status ?? "none",
      current_stage: job?.current_stage ?? null,
      error: job?.error ?? null,
      staged_candidates: job?.candidates_json?.length ?? 0,
      note: "Long runs execute via `npm run nighthawk:run` (ECS cron worker). This route nudges/resumes within 300s.",
    });
  }

  await failStaleNighthawkJobs().catch((err) =>
    console.warn("[cron/nighthawk-edition] stale-job cleanup failed:", err)
  );

  if (!inEditionWindow(force) && !(job && job.status !== "published")) {
    const payload = {
      ok: false,
      skipped: true,
      reason: "Outside edition window — use ?force=1 to nudge/resume",
      edition_for: editionFor,
      job_status: job?.status ?? "none",
      current_stage: job?.current_stage ?? null,
    };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  // FIRE-AND-FORGET (#77 hardening D). Previously this route AWAITED the multi-minute build and
  // raced it against an internal budget, so the cron HTTP handshake routinely outlived hit-cron's
  // 60s timeout — every nightly run logged as FAILED even when the edition published fine (the
  // "every nightly run logs as failed" lie). Now we dispatch the build in the background via
  // next/server `after()` (runs after the response is flushed, on the long-lived ECS worker) and
  // return 202 in well under 60s. The builder checkpoints + publishes on its own; its background
  // `.catch` serializes + ops-alerts so an unhandled rejection can NEVER crash the replica. A re-fire
  // (cron schedule or ?force=1) resumes from the last checkpoint exactly as before.
  const dispatchBuild = () => {
    void buildEveningEdition({
      force,
      ...(asOfEtParam ? { asOfEt: asOfEtParam, persist: persist || force } : {}),
    })
      .then((result) => {
        if (result.ok) {
          console.info(
            `[cron/nighthawk-edition] background build done — ${result.edition_for} ` +
              `status=${result.job_status ?? "?"} stage=${result.current_stage ?? "?"} plays=${result.plays_count}`
          );
        } else {
          // The builder itself already ops-alerts on a hard failure; this is the route-side log so the
          // background outcome is visible in worker logs even if Discord is unset.
          console.error(
            `[cron/nighthawk-edition] background build returned not-ok — ${result.edition_for} ` +
              `status=${result.job_status ?? "?"} stage=${result.current_stage ?? "?"} error=${result.error ?? "?"}`
          );
        }
      })
      .catch(async (error) => {
        // Defensive: buildEveningEdition has its own try/catch and shouldn't reject, but if anything
        // slips through, serialize + ops-alert HERE so it can never become an unhandledRejection that
        // takes down the replica.
        const detail = serializeBuildError(error);
        console.error("[cron/nighthawk-edition] background build REJECTED:", error);
        const failedJob = await fetchNighthawkJob(editionFor).catch(() => null);
        const stage = failedJob?.current_stage ?? job?.current_stage ?? null;
        await notifyOpsDiscord({
          severity: "critical",
          title: `Night Hawk background edition build REJECTED — ${editionFor}`,
          body:
            `stage=${stage ?? "unknown"}\n` +
            `error: ${detail}\n` +
            `[nighthawk-funnel] ${editionFor}: background rejection (see edition-builder funnel log for stage counts)`,
        }).catch(() => undefined);
      });
  };

  // Prefer next/server after() (platform-managed background work bound to the server, not the HTTP
  // response). It is a no-op fallback to a detached promise if after() ever throws (e.g. called
  // outside a request scope), so the build always gets dispatched.
  try {
    after(dispatchBuild);
  } catch {
    dispatchBuild();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "build dispatched in background (fire-and-forget)",
    edition_for: editionFor,
    job_status: job?.status ?? "running",
    current_stage: job?.current_stage ?? "stage_context",
  };
  // Log SUCCESS for the handshake: the build was accepted + dispatched. This is the honest signal —
  // the cron trigger's job is to KICK the build, and it succeeded. The build's own outcome
  // (published / failed) is tracked separately via the nighthawk_job row + the watchdog.
  await logCronRun(CRON_KEY, started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Edition build dispatched in background — poll ?status=1 or the admin cron dashboard for completion.",
    },
    { status: 202 }
  );
}
