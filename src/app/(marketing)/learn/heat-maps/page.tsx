import type { Metadata } from "next";
import { LearnGuideView } from "@/components/learn/LearnGuideView";
import { heatMapsGuide } from "@/lib/learn/guides";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Dealer Gamma Heatmap Guide — Flip, Call & Put Walls",
  "Learn to read a dealer gamma heatmap: find the gamma flip, call wall, and put wall, and understand how dealer positioning drives intraday SPX moves.",
  "/learn/heat-maps"
);

export default function Page() {
  return <LearnGuideView guide={heatMapsGuide} />;
}
