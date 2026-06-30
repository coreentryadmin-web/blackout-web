/** ET window helpers for GitHub Actions RTH workflows (no deps). */
const ET = "America/New_York";

export function etParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    weekday: parts.weekday,
    mins: hour * 60 + minute,
    label: `${parts.weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`,
  };
}

/** Mon–Fri 9:30 AM–4:00 PM ET — US equity RTH. */
export function isRthEt(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

/** Mon–Fri 09:00–16:15 ET — agent validation window (pre-open + post-close cron grace). NOT RTH. */
export function inRthOpenWindow(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 && mins <= 16 * 60 + 15;
}

export function isWeekdayEt(now = new Date()) {
  const { weekday } = etParts(now);
  return weekday !== "Sat" && weekday !== "Sun";
}
