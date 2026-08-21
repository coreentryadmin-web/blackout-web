/**
 * Resolve a Meridian event id for `get_meridian_event`.
 *
 * A pure module because `run-tool.ts` reaches its dependencies through dynamic `@/` imports, which
 * the test runner cannot resolve — so anything that lives inside the tool case cannot be tested,
 * and an id parser that silently mis-resolves is exactly the kind of thing that needs a test.
 *
 * TWO WAYS IN, ON PURPOSE. A model that has just called `get_meridian_timeline` holds real ids and
 * should pass one straight through. A model answering "how did NVDA's last print go" holds a
 * TICKER and a KIND and should not have to guess a date format to construct `earnings:NVDA:...`.
 * Forcing the first path would mean two round trips for every question; allowing only the second
 * would throw away an id the model already has.
 *
 * A REFUSAL EXPLAINS ITSELF. Every failure returns the reason, because "no event" and "your id was
 * malformed" are different facts and only one of them means the calendar is empty.
 */

const KINDS = new Set(["macro", "earnings", "opex", "fda"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type ResolvedEventId =
  | { id: string; kind: string; reason: null }
  | { id: null; kind: null; reason: string };

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate a fully-formed id, or build one from `kind` + `ticker` + `date`.
 *
 * Mirrors `parseMeridianEventId` deliberately rather than importing it: that lives under
 * `src/features/meridian/lib`, and the shape it accepts is a CONTRACT this tool depends on. The
 * mirror is pinned by a test that runs both over the same inputs, so a drift fails loudly instead
 * of turning into a tool that refuses ids the desk considers valid.
 */
export function resolveMeridianEventId(input: {
  id?: unknown;
  kind?: unknown;
  ticker?: unknown;
  date?: unknown;
}): ResolvedEventId {
  const rawId = clean(input.id);
  if (rawId) {
    const parts = rawId.split(":");
    const kind = (parts[0] ?? "").toLowerCase();
    if (!KINDS.has(kind)) {
      return { id: null, kind: null, reason: `"${parts[0] ?? ""}" is not a Meridian event kind — expected macro, earnings, opex or fda.` };
    }
    if (kind === "opex") {
      if (parts.length < 2 || !YMD.test(parts[1] ?? "")) {
        return { id: null, kind: null, reason: "An opex id is `opex:YYYY-MM-DD` (the expiration date)." };
      }
      return { id: `opex:${parts[1]}`, kind, reason: null };
    }
    if (kind === "macro") {
      if (parts.length < 3 || !YMD.test(parts[1] ?? "") || !clean(parts.slice(2).join(":"))) {
        return { id: null, kind: null, reason: "A macro id is `macro:YYYY-MM-DD:Event-Name-Slug`." };
      }
      return { id: `macro:${parts[1]}:${parts.slice(2).join(":")}`, kind, reason: null };
    }
    // earnings | fda — ticker then date.
    if (parts.length < 3 || !clean(parts[1]) || !YMD.test(parts[2] ?? "")) {
      return { id: null, kind: null, reason: `A ${kind} id is \`${kind}:TICKER:YYYY-MM-DD\`.` };
    }
    return { id: `${kind}:${parts[1]!.toUpperCase()}:${parts[2]}`, kind, reason: null };
  }

  // No id — build one from the parts.
  const kind = clean(input.kind).toLowerCase();
  const ticker = clean(input.ticker).toUpperCase();
  const date = clean(input.date);
  if (!kind) {
    return { id: null, kind: null, reason: "Pass an `id` from get_meridian_timeline, or a `kind` plus the parts that kind needs." };
  }
  if (!KINDS.has(kind)) {
    return { id: null, kind: null, reason: `"${kind}" is not a Meridian event kind — expected macro, earnings, opex or fda.` };
  }
  if (!YMD.test(date)) {
    return { id: null, kind: null, reason: `\`date\` must be an ET calendar date, YYYY-MM-DD. Got ${date ? `"${date}"` : "nothing"}.` };
  }
  if (kind === "opex") return { id: `opex:${date}`, kind, reason: null };
  if (kind === "macro") {
    return { id: null, kind: null, reason: "A macro event needs its full `id` from get_meridian_timeline — the event name is part of the key and cannot be guessed." };
  }
  if (!ticker) {
    return { id: null, kind: null, reason: `A ${kind} event needs a \`ticker\`.` };
  }
  return { id: `${kind}:${ticker}:${date}`, kind, reason: null };
}
