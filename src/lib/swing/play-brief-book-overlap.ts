/**
 * Shared book-overlap copy for Book context section + Trade manager coaching (#4110).
 */
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { checkPortfolioOverlap, type PortfolioPosition } from "./portfolio";

export function bookOverlapNarrativeLines(
  play: TerminalPlay,
  openBook: PortfolioPosition[] | undefined,
): string[] {
  if (!openBook?.length) return [];
  const overlap = checkPortfolioOverlap({ ticker: play.ticker, direction: play.direction }, openBook);
  if (!overlap.hasOverlap) return [];

  const lines: string[] = [];
  if (overlap.sameThemeSameDirection.length) {
    const names = overlap.sameThemeSameDirection.map((p) => `${p.ticker} ${p.direction}`).join(", ");
    lines.push(
      `**Concentration** — already holding ${overlap.sameThemeSameDirection.length} same-direction ` +
        `position${overlap.sameThemeSameDirection.length > 1 ? "s" : ""} in theme "${overlap.theme}": ${names}. ` +
        `Adding ${play.ticker} stacks the same wager rather than diversifying risk.`,
    );
  }
  if (overlap.sameThemeOpposedDirection.length) {
    const names = overlap.sameThemeOpposedDirection.map((p) => `${p.ticker} ${p.direction}`).join(", ");
    lines.push(
      `**Internal conflict** — theme "${overlap.theme}" already has an OPPOSED position: ${names}. ` +
        `One leg is structurally betting against the other; this is not a hedge unless intentional.`,
    );
  }
  return lines;
}
