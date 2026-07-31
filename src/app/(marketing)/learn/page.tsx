import type { Metadata } from "next";
import { LearnHub } from "@/components/learn/LearnHub";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut Academy — Learn Options Flow & Dealer Gamma",
  "Free guides to dealer gamma, 0DTE options strategy, order flow, and reading market positioning like the desks do. Learn the concepts behind BlackOut.",
  "/learn"
);

export default function LearnPage() {
  return <LearnHub />;
}
