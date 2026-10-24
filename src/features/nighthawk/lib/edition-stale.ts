import { etNowParts, formatEtDate, isTradingDayEt, todayEt } from "./session";

/** Edition window start in minutes-from-midnight ET (default 17:30). */
export function editionWindowStartMinutes(): number {
  const windowHour = Number(process.env.NIGHTHAWK_EDITION_HOUR_ET ?? "17");
  const windowMin = Number(process.env.NIGHTHAWK_EDITION_MINUTE_ET ?? "30");
  return windowHour * 60 + windowMin;
}

/** True on NYSE trading days inside the evening edition catch-up window. */
export function isInEditionWindow(now = new Date()): boolean {
  const etDate = formatEtDate(now);
  if (!isTradingDayEt(etDate)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const nowMinutes = Number(get("hour")) * 60 + Number(get("minute"));
  const windowStart = editionWindowStartMinutes();
  const catchup = Number(process.env.NIGHTHAWK_EDITION_CATCHUP_MIN ?? "120");
  return nowMinutes >= windowStart && nowMinutes <= windowStart + catchup;
}

/**
 * Ops paging window: one hour after edition start through the catch-up deadline.
 * Gives the fire-and-forget builder time to land before ops-collect pages.
 */
export function inNighthawkEditionCatchupAlertWindow(now = new Date()): boolean {
  const etDate = formatEtDate(now);
  if (!isTradingDayEt(etDate)) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const nowMin = Number(get("hour")) * 60 + Number(get("minute"));
  const windowStart = editionWindowStartMinutes();
  const catchup = Number(process.env.NIGHTHAWK_EDITION_CATCHUP_MIN ?? "120");
  return nowMin >= windowStart + 60 && nowMin <= windowStart + catchup;
}

/** Max idle minutes before a non-terminal nighthawk_jobs row is failed for resume. Shorter during edition window. */
export function nighthawkStaleJobIdleMinutes(now = new Date()): number {
  const defaultHours = Number(process.env.NIGHTHAWK_STALE_JOB_HOURS ?? "4");
  const defaultMin = Number.isFinite(defaultHours) && defaultHours > 0 ? defaultHours * 60 : 240;
  const editionMin = Number(process.env.NIGHTHAWK_STALE_JOB_MIN_EDITION ?? "25");
  if (isInEditionWindow(now)) {
    return Number.isFinite(editionMin) && editionMin > 0 ? editionMin : 25;
  }
  return defaultMin;
}

/** Parse a published_at ISO stamp into ET calendar date + minutes-from-midnight. */
export function publishedAtEtMeta(
  iso: string | null | undefined
): { date: string; minutes: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;

  const date = formatEtDate(d);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  // `hour12: false` renders ET midnight as hour "24" in some ICU versions, not "00" — the
  // same quirk fixed in session.ts's etNowParts/isBeforeOrAtMarketCloseEt (#4703). `% 24`
  // folds 24:xx back to 0:xx so 00:00-00:59 ET computes 0-59 minutes, not 1440-1499.
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  if (!Number.isFinite(minutes)) return null;
  return { date, minutes };
}

/**
 * Evening cron must rebuild when a job is already `published` but the stamp is from
 * before today's edition window (or missing). Pre-close / mistimed resumes must not
 * block tonight's post-close playbook.
 */
export function shouldRebuildStalePublishedEdition(params: {
  publishedAtIso: string | null | undefined;
  windowStartMinutes?: number;
  todayYmd?: string;
  inEditionWindow: boolean;
}): boolean {
  if (!params.inEditionWindow) return false;

  const todayStr = params.todayYmd ?? todayEt();
  const windowStart = params.windowStartMinutes ?? editionWindowStartMinutes();
  const meta = publishedAtEtMeta(params.publishedAtIso);

  // Corrupt/missing stamp on a published row — never skip rebuild inside the window.
  if (!meta) return true;

  return meta.date < todayStr || (meta.date === todayStr && meta.minutes < windowStart);
}

/**
 * Same-day retry gate for a published edition that collapsed to recap-only because the
 * dossier STAGE itself produced zero scored dossiers (`stage_dossiers zeroed` in
 * edition-builder.ts — candidates were found by discovery but every one failed a transient
 * per-ticker fetch, almost always UW rate-limiter queue congestion during the build window,
 * not a real "nothing to show tonight" state). `shouldRebuildStalePublishedEdition` above only
 * rebuilds a published row from a PRIOR day/window — once today's own window has already
 * produced a published row, nothing re-attempts it again this same evening, so a transient
 * congestion spike silently serves an empty board to members for the rest of the night (and,
 * since the cron only naturally re-runs for the NEXT day's edition, for the entire next trading
 * day too — confirmed live twice: 2026-10-16 build -> empty 2026-10-19 board all day, then the
 * identical signature again on the very next build, 2026-10-19 -> 2026-10-20).
 *
 * Deliberately narrower than "any recap-only edition with candidates>0": `dossiers===0` targets
 * only the proven total-collapse-at-staging failure specifically, not a recap-only caused by
 * publish gates legitimately blocking every scored play (`publishGateBlockedRecapReason` —
 * `dossiers`/`synthesized`/`critic_passed` are non-zero there, so this returns false and a real
 * quality/risk gate decision is never silently re-run hoping for a different answer). The
 * cooldown (default 45 min — comfortably longer than the ~7.6-minute UW queue-depth spike
 * documented for the 2026-10-16 incident) also self-rate-limits retries: a retry that itself
 * collapses again re-stamps `published_at` to the retry's own publish time, so the NEXT retry
 * needs the full cooldown to elapse again, bounding this to roughly one retry per cooldown
 * window rather than hammering an already-congested upstream on every ~15min cron tick.
 */
export function shouldRetryRecapOnlyEdition(params: {
  recapOnly: boolean;
  candidates: number;
  dossiers: number;
  publishedAtIso: string | null | undefined;
  inEditionWindow: boolean;
  now?: Date;
  cooldownMinutes?: number;
}): boolean {
  if (!params.inEditionWindow) return false;
  if (!params.recapOnly) return false;
  if (!(params.candidates > 0)) return false;
  if (params.dossiers !== 0) return false;
  if (!params.publishedAtIso) return false;

  const publishedAtMs = new Date(params.publishedAtIso).getTime();
  if (!Number.isFinite(publishedAtMs)) return false;

  const cooldownMinutes =
    params.cooldownMinutes ?? Number(process.env.NIGHTHAWK_RECAP_RETRY_COOLDOWN_MIN ?? "45");
  const now = params.now ?? new Date();
  const elapsedMinutes = (now.getTime() - publishedAtMs) / 60000;
  return elapsedMinutes >= cooldownMinutes;
}
