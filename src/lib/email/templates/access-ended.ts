import { SITE } from "@/lib/site";
import { emailLayout, emailCta, EMAIL_BRAND, substituteTokens } from "@/lib/email/layout";
import type { EmailAttachment } from "@/lib/email/resend-client";
import type { Tier } from "@/lib/tiers";

export type AccessEndedContext = { firstName?: string | null; previousTier: Tier };

/** Fires the moment a subscription is fully cancelled and access has ended
 *  (back to free). The real "exit" moment. Respect the decision — zero
 *  guilt-trip, zero dark-pattern pressure. One genuine low-key note that
 *  they're welcome back; a real desk doesn't beg. */
export function accessEndedEmail(ctx: AccessEndedContext): { subject: string; html: string; attachments: EmailAttachment[] } {
  const tokens = { firstName: ctx.firstName?.trim() || "Trader" };
  const t = (s: string) => substituteTokens(s, tokens);
  // Full cancellation can land here from either paid tier — a Premium member
  // loses the whole seven-product desk, not just the 0DTE engines a
  // community (SPX Slayer) member loses. `previousTier` was accepted on this
  // context since the lifecycle emails first shipped (#1901) but never
  // actually read, so every full cancellation got the narrower,
  // community-shaped wording below regardless of what the member was really
  // losing — the same personalization sibling templates already apply
  // (welcomePremiumEmail's dual-opener, downgradeEmail's explicit six-engine
  // list).
  const fromPremium = ctx.previousTier === "premium";

  const subject = t("Lights out on your terminal, {{firstName}}");
  const openingParagraph = fromPremium
    ? "Somewhere on the desk right now, dealer gamma is flipping and a sweep just lit up someone else's screen. The tape doesn't pause for anybody — not even for {{firstName}}. Your subscription's closed out, and access ended the moment it did: the live reads, the GEX/flow feeds, the graded 0DTE setups, and the other six engines riding alongside them — Thermal, HELIX, Night Hawk, Largo AI, Vector, Meridian — all gone at once. You're back on the free tier. Clean cutoff, no partial states."
    : "Somewhere on the desk right now, dealer gamma is flipping and a sweep just lit up someone else's screen. The tape doesn't pause for anybody — not even for {{firstName}}. Your subscription's closed out, and access ended the moment it did: the live reads, the GEX/flow feeds, the graded 0DTE setups — gone. You're back on the free tier. Clean cutoff, no partial states.";
  const paragraphs = [
    openingParagraph,
    "Here's what that access bought you while it lasted: every setup graded A through F before anyone knew how it ended, every closed play — win or loss — logged against that original grade. No hindsight edits, no quiet deletions. That's the standard, and it's the first thing that goes dark when the sub ends.",
    "No guilt trip coming. You made a call — it's yours to make, and we respect it. That's the whole email. If the itch comes back someday, nothing resets: same grading standard, same live reads, same door, wide open — SPX Slayer for the 0DTE desk, Premium for the full seven-engine stack.",
  ]
    .map((p) => `<p style="margin:0 0 18px;color:${EMAIL_BRAND.body};">${t(p)}</p>`)
    .join("");

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:${EMAIL_BRAND.ink};line-height:1.3;">Lights out on your terminal.</h1>
    ${paragraphs}
    ${emailCta(`${SITE.url}/pricing`, "Back to the floor, anytime")}
    <p style="margin:0;color:${EMAIL_BRAND.muted};font-size:14px;">Trade well, wherever you're watching from. — BlackOut Trades</p>
  `;

  const layout = emailLayout({
    preheader: "No guilt trip. No hard sell. Just the facts.",
    bodyHtml: body,
  });
  return { subject, html: layout.html, attachments: layout.attachments };
}
