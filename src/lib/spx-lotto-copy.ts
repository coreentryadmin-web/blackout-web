import type { LottoPhase } from "@/lib/spx-lotto-store";
import type { SpxPlayDirection } from "@/lib/spx-signals";

export type LottoNoneReason =
  | "off_hours"
  | "no_qualify"
  | "expired"
  | "stopped"
  | "invalidated_no_reversal"
  | "max_picks"
  | "closed_for_today";

export type LottoCopyLine = {
  kicker: string;
  headline: string;
  thesis: string;
  footnote?: string;
};

export function lottoPhaseKicker(phase: LottoPhase, isReversal = false): string {
  switch (phase) {
    case "SCAN":
      return "🔮 ORACLE MODE";
    case "WATCH":
      return isReversal ? "🔄 HOUSE FLIPPED" : "🎫 TICKET PRINTED";
    case "BUY":
      return "🚀 DEGEN MODE: ENGAGED";
    case "HOLD":
      return "🎲 CHIP IN PLAY";
    case "SELL":
      return "💰 TABLE PAID";
    case "INVALID":
      return "☠️ TICKET SHREDDED";
    default:
      return "🎰 LOTTO VAULT";
  }
}

export function lottoNoneCopy(reason: LottoNoneReason): LottoCopyLine {
  switch (reason) {
    case "off_hours":
      return {
        kicker: "🌙 VAULT LOCKED",
        headline: "Lotto engines sleep until dawn.",
        thesis: "Back at 7:00 AM ET — when catalysts wake up and degenerates return to the floor.",
      };
    case "no_qualify":
      return {
        kicker: "😴 DREAMLESS MORNING",
        headline: "No lotto today — tape refused to cooperate.",
        thesis: "Catalyst thin or direction split. The house passes. Come back when the story's obvious.",
      };
    case "expired":
      return {
        kicker: "⏰ WINDOW SHUT",
        headline: "10:30 ET — the lotto window slammed closed.",
        thesis: "Far-OTM premium doesn't wait. No entry, no regret. Tomorrow's another spin.",
      };
    case "stopped":
      return {
        kicker: "🔻 RUG PULLED",
        headline: "LOTTO STOPPED — −8pt from entry.",
        thesis: "Premium went poof. That's the 0DTE tax. Small size, move on.",
      };
    case "invalidated_no_reversal":
      return {
        kicker: "💨 WRONG AT THE BELL",
        headline: "Thesis murdered at the open — no reversal ticket.",
        thesis: "≥8pt against the anchor before fill. Reversal scan found nothing. House collects.",
      };
    case "max_picks":
      return {
        kicker: "🛑 TWO STRIKES",
        headline: "Max lotto picks burned for the day.",
        thesis: "Primary + reversal both spent. Floor's closed — main desk still open.",
      };
    case "closed_for_today":
      return {
        kicker: "🚪 TABLE CLOSED",
        headline: "Lotto session wrapped — see you tomorrow.",
        thesis: "Ticket settled. Vault locks until the next pre-market hunt.",
      };
  }
}

export function lottoWatchHeadline(
  direction: SpxPlayDirection,
  strike: number,
  targetPts: number,
  isReversal: boolean
): string {
  const side = direction === "long" ? "CALL" : "PUT";
  const vibe = isReversal ? "Reversal rocket" : "Moonshot";
  return `${side} ${vibe} · ${strike} strike · ±${targetPts}pt chaos`;
}

export function lottoWatchThesis(catalystSummary: string, isReversal: boolean): string {
  if (isReversal) {
    return `Plot twist: ${catalystSummary} — second ticket, same rules, new anchor.`;
  }
  return `Morning thesis locked: ${catalystSummary}`;
}

export function lottoWatchStatusMessage(
  isReversal: boolean,
  ticketBlocked: boolean,
  blockReason?: string | null
): string {
  if (ticketBlocked) {
    return `${blockReason ?? "Chain estimate only"} · size it like a lottery ticket, not a conviction play`;
  }
  if (isReversal) {
    return "Reversal watch live — waiting for the tape to prove the flip at open.";
  }
  return "Ticket's printed — waiting for the bell and an 8pt confirm at cash open.";
}

export function lottoBuyStatusMessage(): string {
  return "Open confirmed — ticket live on the floor. Separate from main desk plays.";
}

export function lottoHoldStatusMessage(): string {
  return "Runner working — far OTM, max theta, pure lotto energy.";
}

export function lottoWinStatusMessage(targetPts: number): string {
  return `JACKPOT — +${targetPts}pt target hit. The lotto actually paid.`;
}

export function lottoPanelLoadingCopy(): LottoCopyLine {
  return {
    kicker: "🔮 READING THE ORACLE",
    headline: "Shuffling catalysts, flow, and gap…",
    thesis: "The machine is whispering. Stand by for a ticket or a pass.",
    footnote: "Scanning pre-market intel",
  };
}

export function lottoPanelOffHoursCopy(): LottoCopyLine {
  return lottoNoneCopy("off_hours");
}

export function lottoPanelEmptyCopy(engineHeadline?: string | null): LottoCopyLine {
  const base = lottoNoneCopy("no_qualify");
  if (!engineHeadline || engineHeadline === "No lottos today") return base;
  return {
    ...base,
    thesis: engineHeadline,
  };
}
