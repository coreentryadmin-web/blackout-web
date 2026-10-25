// Phase-anchored swing-discovery cron health — member-facing artifact is the serving snapshot,
// not the cron_job_runs handshake. EventBridge fires every 30m but only phase windows run scans;
// a long gap without logged rows (401 before logCronRun, deploy blip) must not page when
// `swing:serving:latest:v1` still reflects today's session.

import { todayEt } from "@/lib/et-date";
import { formatEtDate, isTradingDayEt, previousTradingDayEt } from "@/features/nighthawk/lib/session";
import { SWING_SCAN_PHASES, etMinutesOfDay } from "@/lib/swing/scan-cadence";
import type { SwingServingSnapshot } from "@/lib/swing/serving-lane";
import { ageMinFromIso } from "@/lib/ws/timestamp-freshness";

/** Worst ordinary calendar gap with no scan (Fri POST_CLOSE end → Mon PRE_OPEN start). Minutes. */
export function worstOrdinarySwingDiscoveryGapMin(): number {
  const postCloseEndMin = SWING_SCAN_PHASES.find((w) => w.phase === "POST_CLOSE")!.endMin;
  const preOpenStartMin = SWING_SCAN_PHASES.find((w) => w.phase === "PRE_OPEN")!.startMin;
  const minutesInDay = 24 * 60;
  const fridayRemainderMin = minutesInDay - postCloseEndMin;
  const weekendMin = 2 * minutesInDay;
  return fridayRemainderMin + weekendMin + preOpenStartMin;
}

/** Stale ceiling for cron_job_runs handshake — must exceed the weekly gap, not just 36h. */
export function swingDiscoveryHandshakeStaleMin(): number {
  return worstOrdinarySwingDiscoveryGapMin() + 120;
}

function etYmdToUtcMs(ymd: string, minutesSinceMidnight: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const hh = Math.floor(minutesSinceMidnight / 60) % 24;
  const mm = minutesSinceMidnight % 60;
  const guess = Date.UTC(y, m - 1, d, hh + 4, mm, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guess));
  const etHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const etMinute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const deltaMin = minutesSinceMidnight - (etHour * 60 + etMinute);
  return guess + deltaMin * 60_000;
}

/**
 * Phases whose ET window has fully ended before `now` on `sessionDay`, in the order they ended
 * (ascending `endMin`) — NOT `SWING_SCAN_PHASES`' own array order.
 *
 * BUG FIX (Ask Largo standing mandate, 2026-10-25): this used to return `.filter(...).map(...)` in
 * `SWING_SCAN_PHASES`' array order, which `scan-cadence.ts`'s own header is explicit is NOT
 * chronological — POST_CLOSE is deliberately listed first for render/iteration purposes ("the
 * stable render/iteration order puts it at the head. Correctness does NOT depend on this order
 * ... only the render/first-of order does"). This function's own caller,
 * `probeSwingDiscoveryServingSnapshot` below, takes `endedPhases[endedPhases.length - 1]` and
 * trusts it to be the MOST RECENTLY ended phase — exactly the "first-of/last-of" use the module
 * header warns depends on real chronological order.
 *
 * Live repro: at 21:00 ET (after POST_CLOSE ends at 20:00, before OVERNIGHT ends at 24:00), the
 * array-order filter returns `[POST_CLOSE, PRE_OPEN, MIDDAY, POWER_HOUR]` (OVERNIGHT still active) —
 * taking the last element gives `POWER_HOUR` (ended 16:00), when `POST_CLOSE` (ended 20:00, the
 * PRIMARY phase — "the cleanest read of the day's accumulation" per scan-cadence.ts) is the one
 * that actually ended most recently. The consumer then floors the freshness check at POWER_HOUR's
 * 15:00 start instead of POST_CLOSE's 16:15 start — a snapshot timestamped 15:05 ET (predating
 * POST_CLOSE's own start entirely, so it cannot possibly reflect POST_CLOSE having run) read
 * `fresh: true` at 21:00 ET pre-fix. Sorting by `endMin` ascending before returning fixes both this
 * function's own `.join(",")` display order and every `[length-1]`-style "most recent" consumer.
 */
export function swingDiscoveryPhasesEndedBefore(now: Date, sessionDay: string): string[] {
  const mins = etMinutesOfDay(now.getTime());
  return SWING_SCAN_PHASES.filter((w) => mins >= w.endMin)
    .sort((a, b) => a.endMin - b.endMin)
    .map((w) => w.phase);
}

export type SwingDiscoveryServingProbe = { fresh: boolean; detail: string };

/**
 * True when the persisted serving snapshot proves discovery ran for the session the clock expects.
 * Used to suppress handshake-only staleness on the admin board / cron watchdog (same pattern as
 * zerodte-warm's scanner heartbeat probe).
 */
export function probeSwingDiscoveryServingSnapshot(
  snapshot: SwingServingSnapshot | null,
  now = new Date()
): SwingDiscoveryServingProbe {
  if (!snapshot?.sessionDay || !snapshot.asOf) {
    return { fresh: false, detail: "no swing serving snapshot" };
  }

  const sessionDay = todayEt(now);
  const etDate = formatEtDate(now);
  if (!isTradingDayEt(etDate)) {
    const ageMin = ageMinFromIso(snapshot.asOf, now.getTime());
    const maxMin = swingDiscoveryHandshakeStaleMin();
    if (ageMin != null && ageMin <= maxMin) {
      return {
        fresh: true,
        detail: `off-hours snapshot ${snapshot.sessionDay} (${ageMin.toFixed(0)}m old, within ${maxMin}m weekly ceiling)`,
      };
    }
    return { fresh: false, detail: "off-hours snapshot too old for weekly gap" };
  }

  const asOfMs = new Date(snapshot.asOf).getTime();
  if (!Number.isFinite(asOfMs)) {
    return { fresh: false, detail: "invalid serving snapshot asOf" };
  }

  const allowedSessionDays = new Set<string>([sessionDay]);
  const preOpenStart = SWING_SCAN_PHASES.find((w) => w.phase === "PRE_OPEN")!.startMin;
  if (etMinutesOfDay(now.getTime()) < preOpenStart) {
    allowedSessionDays.add(previousTradingDayEt(sessionDay));
  }

  if (!allowedSessionDays.has(snapshot.sessionDay)) {
    return {
      fresh: false,
      detail: `snapshot session ${snapshot.sessionDay} lags expected ${sessionDay}`,
    };
  }

  const endedPhases = swingDiscoveryPhasesEndedBefore(now, sessionDay);
  if (endedPhases.length === 0) {
    const ageMin = ageMinFromIso(snapshot.asOf, now.getTime());
    const maxMin = swingDiscoveryHandshakeStaleMin();
    if (ageMin != null && ageMin <= maxMin) {
      return {
        fresh: true,
        detail: `pre-phase snapshot ${snapshot.sessionDay} (${ageMin.toFixed(0)}m old)`,
      };
    }
    return { fresh: false, detail: "pre-phase snapshot too old" };
  }

  const lastEnded = SWING_SCAN_PHASES.find((w) => w.phase === endedPhases[endedPhases.length - 1])!;
  const phaseFloorMs = etYmdToUtcMs(sessionDay, lastEnded.startMin);
  if (asOfMs + 60_000 < phaseFloorMs) {
    return {
      fresh: false,
      detail: `snapshot asOf predates ended phase ${lastEnded.phase} for ${sessionDay}`,
    };
  }

  const ageMin = ageMinFromIso(snapshot.asOf, now.getTime());
  const intraDayCeilingMin = 16 * 60;
  if (ageMin != null && ageMin <= intraDayCeilingMin) {
    return {
      fresh: true,
      detail: `serving snapshot ${snapshot.sessionDay} · ${ageMin.toFixed(0)}m old · phases ended: ${endedPhases.join(",")}`,
    };
  }

  return {
    fresh: false,
    detail: `serving snapshot too old intraday (${ageMin != null ? `${ageMin.toFixed(0)}m` : "?"})`,
  };
}
