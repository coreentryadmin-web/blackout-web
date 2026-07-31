import type { Metadata } from "next";
import { LearnGlossaryPage } from "@/components/learn/LearnGlossaryPage";
import { publicPageMetadata } from "@/lib/page-metadata";

export const metadata: Metadata = publicPageMetadata(
  "Options Trading Glossary — Gamma, 0DTE, Flow Terms",
  "A plain-English glossary of options trading terms: dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow, and more, explained simply.",
  "/learn/glossary"
);

export default function Page() {
  return <LearnGlossaryPage />;
}
