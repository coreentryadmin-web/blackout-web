/**
 * Pure verdict for deploy-smoke's authenticated SPX desk probe (unit-tested).
 */
import { inRthOpenWindow, isTradingDayEt, todayEtYmd } from "../../gha-et-window.mjs";

function deskPayloadLooksValid(body) {
  return Boolean(body && typeof body === "object" && typeof body.available === "boolean");
}

/** Mon–Fri 09:30–16:00 ET on a trading day — when members expect a grounded spot on the desk. */
export function inCashEquityRth(now = new Date()) {
  const ymd = todayEtYmd(now);
  if (!isTradingDayEt(ymd)) return false;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * @returns {{ outcome: "pass" | "warn" | "fail", line: string }}
 */
export function evaluateSpxDeskCronSmoke(status, body, now = new Date()) {
  if (status === 401 || status === 403) {
    return {
      outcome: "warn",
      line:
        `${status} (route up + gated; CI CRON_SECRET does not match the deployed value — reconcile it to re-enable the authenticated price check)`,
    };
  }

  if (status !== 200) {
    return { outcome: "fail", line: String(status) };
  }

  if (typeof body?.price === "number" && body.price > 0) {
    return { outcome: "pass", line: `SPX ${body.price} (cron auth ok)` };
  }

  if (body?.available === false && deskPayloadLooksValid(body)) {
    return {
      outcome: "pass",
      line: "desk unavailable (honest empty state — cold cache or still building)",
    };
  }

  // Off-hours/weekends: route auth + JSON shape is enough; live spot is not required.
  if (!inCashEquityRth(now) && deskPayloadLooksValid(body)) {
    return {
      outcome: "pass",
      line: "desk JSON ok (off-hours — spot not required for deploy smoke)",
    };
  }

  // Legacy grace: gha-et-window RTH band is wider (09:00–16:15); pre-open may still be warming.
  if (!inRthOpenWindow(now) && deskPayloadLooksValid(body)) {
    return { outcome: "pass", line: "desk JSON ok (outside RTH window)" };
  }

  return { outcome: "fail", line: String(status) };
}
