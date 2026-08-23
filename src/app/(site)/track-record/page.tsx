import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "BlackOut Trade Record — Graded 0DTE & Swing Plays, Full Transparency",
  description: "Transparent trade record of every BlackOut-graded 0DTE and swing setup. See entry, target, stop, outcome, and win rate. No cherry-picking — includes all plays, winners and losers.",
  robots: "noindex, nofollow",
};

/** Legacy public URL — track record is admin-only under Admin console. */
export default function TrackRecordLegacyRedirect() {
  redirect("/admin?tab=track-record");
}
