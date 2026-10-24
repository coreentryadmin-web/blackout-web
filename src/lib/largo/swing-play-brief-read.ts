// Largo tool wrapper for the Swing Play Intelligence brief — until this file, `composeSwingPlayBrief`
// (src/lib/swing/play-brief.ts) was reachable ONLY from the Command Deck UI panel's own route
// (src/app/api/market/swing/play-brief/route.ts), never from a live Largo chat answer: `get_swing_horizon`
// is the only swing tool Largo could call, and it returns board counts + a few sample plays, nothing
// from the play-brief (narrative sections, book-context concentration, archetype track record, roll
// history, counter-thesis). See docs/audit/findings-staging/2026-09-12-largo-swing-play-brief-tool-unwired.md
// for the full trace. This wrapper calls the EXACT SAME resolve -> compose pipeline the route uses, so a
// chat answer and the panel read identical data through identical logic — never a second, drifting copy.
import { roundFloats } from "@/lib/round-floats";
import { loadSwingPlayBriefContext } from "@/lib/swing/play-brief-context";
import { composeSwingPlayBrief } from "@/lib/swing/play-brief";

export type SwingPlayBriefLargoHints = {
  positionId?: number | null;
  status?: string | null;
  strike?: number | null;
  right?: string | null;
};

export async function swingPlayBriefForLargo(ticker: string, hints?: SwingPlayBriefLargoHints) {
  const t = (ticker ?? "").trim().toUpperCase();
  if (!t) {
    return {
      available: false,
      error: "ticker_required",
      // Largo contract C3 (never signal absence without a reason) — see this file's own
      // `unavailable` additions below for the full rationale.
      unavailable: { reason: "ticker_required", what_is_missing: "a non-empty ticker", retryable: false },
    };
  }
  try {
    // playId is a required SwingBriefResolveHints field, but resolveSwingPlayForBrief prefers
    // `ticker` over the playId-parsed one whenever `ticker` is supplied (see its own comment:
    // "Blank ticker from the route must not block playId-derived resolution (Largo tool omits
    // ?ticker=)" — this synthetic `SWING:<ticker>` id is exactly that already-anticipated shape.
    const ctx = await loadSwingPlayBriefContext({
      playId: `SWING:${t}`,
      ticker: t,
      positionId: hints?.positionId ?? null,
      status: hints?.status ?? null,
      strike: hints?.strike ?? null,
      right: hints?.right ?? null,
    });
    if (!ctx) {
      const note = `No open, watch, or recently closed Swing position found for ${t}.`;
      return {
        available: false,
        error: "play_not_found",
        note,
        // BUG FIX (Ask Largo standing mandate, 2026-10-19): every top-level failure path here
        // used to return a bare {available:false, ...} with no `reason`/`what_is_missing`/
        // `retryable` — the exact C3 ambiguity LARGO-PRODUCT-CONTRACT.md says is a defect "even
        // when every test passes," since a caller (or Largo itself) can't tell a transient
        // provider hiccup (retry) from a ticker that genuinely has no brief (don't retry) from
        // an actual bug. This case is the "genuinely doesn't exist" kind — not retryable.
        unavailable: {
          reason: note,
          what_is_missing: "an open, watch, or recently closed Swing position for this ticker",
          retryable: false,
        },
      };
    }
    const brief = composeSwingPlayBrief(ctx);
    return roundFloats({ available: true, ...brief });
  } catch (e) {
    const message = e instanceof Error ? e.message : "swing_play_brief_failed";
    return {
      available: false,
      error: message,
      // An unhandled exception (DB hiccup, upstream timeout, a real bug) is the ambiguous case
      // the Unavailable type exists to flag — default retryable:true, the safer signal for a
      // caller that can't otherwise distinguish "transient, ask again" from "a real defect."
      unavailable: { reason: message, what_is_missing: "a successfully composed play-brief", retryable: true },
    };
  }
}
