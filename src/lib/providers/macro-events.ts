export type MacroEvent = {
  time: string;
  event: string;
  country: string;
  impact: string;
  actual?: string | null;
  estimate?: string | null;
};

/** Curated US macro dates — update quarterly. */
const US_MACRO_SCHEDULE_2026: Array<{ date: string; event: string; impact: "high" | "medium" }> = [
  { date: "2026-01-10", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-01-14", event: "CPI", impact: "high" },
  { date: "2026-01-28", event: "FOMC Decision", impact: "high" },
  { date: "2026-01-29", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-02-07", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-02-12", event: "CPI", impact: "high" },
  { date: "2026-03-07", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-03-12", event: "CPI", impact: "high" },
  { date: "2026-03-18", event: "FOMC Decision", impact: "high" },
  { date: "2026-03-19", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-04-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-04-10", event: "CPI", impact: "high" },
  { date: "2026-05-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-05-13", event: "CPI", impact: "high" },
  { date: "2026-05-07", event: "FOMC Decision", impact: "high" },
  { date: "2026-06-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-06-11", event: "CPI", impact: "high" },
  { date: "2026-06-17", event: "FOMC Decision", impact: "high" },
  { date: "2026-06-18", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-07-03", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-07-14", event: "CPI", impact: "high" },
  { date: "2026-07-29", event: "FOMC Decision", impact: "high" },
  { date: "2026-07-30", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-08-07", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-08-12", event: "CPI", impact: "high" },
  { date: "2026-09-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-09-11", event: "CPI", impact: "high" },
  { date: "2026-09-16", event: "FOMC Decision", impact: "high" },
  { date: "2026-09-17", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-10-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-10-14", event: "CPI", impact: "high" },
  { date: "2026-11-06", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-11-04", event: "FOMC Decision", impact: "high" },
  { date: "2026-11-05", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-11-13", event: "CPI", impact: "high" },
  { date: "2026-12-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2026-12-09", event: "FOMC Decision", impact: "high" },
  { date: "2026-12-10", event: "FOMC Press Conference", impact: "high" },
  { date: "2026-12-11", event: "CPI", impact: "high" },
];

const US_MACRO_SCHEDULE_2027: Array<{ date: string; event: string; impact: "high" | "medium" }> = [
  { date: "2027-01-08", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-01-13", event: "CPI", impact: "high" },
  { date: "2027-01-27", event: "FOMC Decision", impact: "high" },
  { date: "2027-01-28", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-02-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-02-10", event: "CPI", impact: "high" },
  { date: "2027-03-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-03-10", event: "CPI", impact: "high" },
  { date: "2027-03-17", event: "FOMC Decision", impact: "high" },
  { date: "2027-03-18", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-04-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-04-13", event: "CPI", impact: "high" },
  { date: "2027-05-07", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-05-12", event: "CPI", impact: "high" },
  { date: "2027-05-05", event: "FOMC Decision", impact: "high" },
  { date: "2027-06-04", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-06-10", event: "CPI", impact: "high" },
  { date: "2027-06-16", event: "FOMC Decision", impact: "high" },
  { date: "2027-06-17", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-07-02", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-07-14", event: "CPI", impact: "high" },
  { date: "2027-07-28", event: "FOMC Decision", impact: "high" },
  { date: "2027-07-29", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-08-06", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-08-11", event: "CPI", impact: "high" },
  { date: "2027-09-03", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-09-14", event: "CPI", impact: "high" },
  { date: "2027-09-22", event: "FOMC Decision", impact: "high" },
  { date: "2027-09-23", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-10-01", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-10-13", event: "CPI", impact: "high" },
  { date: "2027-11-05", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-11-03", event: "FOMC Decision", impact: "high" },
  { date: "2027-11-04", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-11-10", event: "CPI", impact: "high" },
  { date: "2027-12-03", event: "Nonfarm Payrolls (NFP)", impact: "high" },
  { date: "2027-12-08", event: "FOMC Decision", impact: "high" },
  { date: "2027-12-09", event: "FOMC Press Conference", impact: "high" },
  { date: "2027-12-10", event: "CPI", impact: "high" },
];

const ALL_MACRO_SCHEDULE = [...US_MACRO_SCHEDULE_2026, ...US_MACRO_SCHEDULE_2027];

const MACRO_HEADLINE_RE =
  /\b(CPI|FOMC|FED|PCE|NFP|NONFARM|JOBS|PAYROLL|PPI|GDP|RETAIL SALES|ISM|PMI|UNEMPLOYMENT|CLAIMS|RATE DECISION|POWELL)\b/i;

function todayEtYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function scheduleRowToEvent(e: { date: string; event: string; impact: "high" | "medium" }): MacroEvent {
  return {
    time: "08:30",
    event: e.event,
    country: "US",
    impact: e.impact,
    actual: null,
    estimate: null,
  };
}

function staticMacroToday(now = new Date()): MacroEvent[] {
  const today = todayEtYmd(now);
  return ALL_MACRO_SCHEDULE.filter((e) => e.date === today).map(scheduleRowToEvent);
}

/** High-impact US macro events on a specific ET calendar date. */
export function macroEventsOnDate(dateYmd: string): MacroEvent[] {
  return ALL_MACRO_SCHEDULE.filter((e) => e.date === dateYmd).map(scheduleRowToEvent);
}

function macroFromHeadlines(
  headlines: Array<{ title?: string }> | undefined
): MacroEvent[] {
  const hits: MacroEvent[] = [];
  for (const h of headlines?.slice(0, 8) ?? []) {
    const title = h.title ?? "";
    if (!MACRO_HEADLINE_RE.test(title)) continue;
    hits.push({
      time: "",
      event: `News: ${title.slice(0, 72)}`,
      country: "US",
      impact: "medium",
      actual: null,
      estimate: null,
    });
  }
  return hits.slice(0, 3);
}

function dedupeEvents(events: MacroEvent[]): MacroEvent[] {
  const seen = new Set<string>();
  const out: MacroEvent[] = [];
  for (const e of events) {
    const key = e.event.toUpperCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, 8);
}

/** Resolve today's macro catalysts from curated schedule + headline keywords. */
export async function resolveMacroEventsToday(input: {
  headlines?: Array<{ title?: string }>;
}): Promise<{ events: MacroEvent[]; source: "static" | "headlines" | "none" }> {
  const staticHits = staticMacroToday();
  if (staticHits.length > 0) {
    return { events: staticHits, source: "static" };
  }

  const fromNews = macroFromHeadlines(input.headlines);
  if (fromNews.length > 0) {
    return { events: fromNews, source: "headlines" };
  }

  return { events: [], source: "none" };
}

/** Merge static schedule + headline keywords for desk macro rail. */
export async function mergeMacroEventsToday(input: {
  headlines?: Array<{ title?: string }>;
}): Promise<MacroEvent[]> {
  const staticHits = staticMacroToday();
  const fromNews = macroFromHeadlines(input.headlines);
  return dedupeEvents([...staticHits, ...fromNews]);
}

/** Upcoming US macro from curated schedule. */
export function fetchUpcomingMacroEvents(daysAhead = 7): MacroEvent[] {
  const today = todayEtYmd();
  const endMs = Date.now() + Math.max(1, daysAhead) * 86400000;
  const end = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(endMs));

  return ALL_MACRO_SCHEDULE.filter((e) => e.date >= today && e.date <= end).map((e) => ({
    time: "08:30",
    event: e.event,
    country: "US",
    impact: e.impact,
    actual: null,
    estimate: null,
  }));
}
