import { etNowParts, formatEtDate, isTradingDayEt, todayEt } from "./session";

/** Edition window start in minutes-from-midnight ET (default 17:30). */
export function editionWindowStartMinutes(): number {
  const windowHour = Number(process.env.NIGHTHAWK_EDITION_HOUR_ET ?? "17");
  const windowMin = Number(process.env.NIGHTHAWK_EDITION_MINUTE_ET ?? "30");
  return windowHour * 60 + windowMin;
}

/** True on NYSE trading days inside the evening edition catch-up window. */
export function isInEditionWindow(now = new Date()): boolean {
  void now;
  if (!isTradingDayEt(todayEt())) return false;
  const { hour, minute } = etNowParts();
  const nowMinutes = hour * 60 + minute;
  const windowStart = editionWindowStartMinutes();
  const catchup = Number(process.env.NIGHTHAWK_EDITION_CATCHUP_MIN ?? "120");
  return nowMinutes >= windowStart && nowMinutes <= windowStart + catchup;
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
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
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
