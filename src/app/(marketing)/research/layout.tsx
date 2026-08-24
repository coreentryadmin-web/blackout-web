import type { Metadata } from "next";

/**
 * Research routes stay reachable for humans who have the URL, but are withheld from
 * search indexes until the operator resolves the open Polygon/UW redistribution question.
 * Standing SEO brief: docs/agents/SEO-SEARCH-AUTHORITY.md § HARD CONSTRAINT.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
