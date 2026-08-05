/**
 * AI spend policy — staging defaults to BIE-only (zero Anthropic) except Largo when opted in.
 * - STAGING_CLAUDE=1 — global Claude (commentary, flow-brief, etc.) for A/B tests.
 * - STAGING_LARGO_CLAUDE=1 — Claude for Largo terminal only; SPX commentary stays BIE.
 *
 * Largo is Claude-only: the deterministic BIE router was removed from `/terminal` (2026-08).
 * BIE composers still power SPX commentary and other non-Largo surfaces.
 */
import { isStagingDeploy } from "@/lib/clerk-env";
import { anthropicConfigured } from "@/lib/providers/anthropic";

/** True when Anthropic calls are allowed in this deploy (all surfaces). */
export function claudeEnabled(): boolean {
  if (process.env.STAGING_CLAUDE === "1") return anthropicConfigured();
  if (isStagingDeploy()) return false;
  return anthropicConfigured();
}

/** Claude allowed for the Largo product only — does not enable SPX commentary / flow-brief LLM. */
export function largoClaudeEnabled(): boolean {
  if (!anthropicConfigured()) return false;
  if (isStagingDeploy()) {
    return process.env.STAGING_LARGO_CLAUDE === "1" || process.env.STAGING_CLAUDE === "1";
  }
  return true;
}

/** @deprecated Largo no longer runs the BIE router — always Claude + tools. Kept for call-site compat. */
export function largoSkipBieRouter(): boolean {
  return true;
}

/** Largo terminal requires Anthropic (Claude tool loop). */
export function largoAvailable(): boolean {
  return largoClaudeEnabled();
}

/** Staging deploy with default BIE-only policy (STAGING_CLAUDE≠1 and STAGING_LARGO_CLAUDE≠1). */
export function isStagingBieMode(): boolean {
  return (
    isStagingDeploy() &&
    process.env.STAGING_CLAUDE !== "1" &&
    process.env.STAGING_LARGO_CLAUDE !== "1"
  );
}

/** @deprecated Largo is Claude-only; BIE-without-Claude mode was removed. */
export function largoBieOnly(): boolean {
  return false;
}
