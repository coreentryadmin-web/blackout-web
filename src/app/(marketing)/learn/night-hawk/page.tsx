import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { nightHawkGuide } from "@/lib/learn/guides";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Night Hawk Guide — Swing Trading Setups Explained",
  "Learn how Night Hawk grades swing trading setups and runs its evening scanner to surface the next day's best opportunities after the market closes.",
  "/learn/night-hawk"
);

export default function Page() {
  return <LearnGuideView guide={nightHawkGuide} />;
}
