/**
 * Extract Legacy Discord trade fields from a pinned publish_context and/or edition play.
 *
 * PR-N4 publish_context pins geometry/regime at the top level — NOT under `final_output`.
 * Audit-trail rows use `final_output.options_play`; live-sync must read both shapes and
 * fall back to the edition JSON when older pins omit the contract string.
 */
export type LegacyPublishFieldSource = {
  publish_context?: Record<string, unknown> | null;
  editionPlay?: {
    options_play?: string | null;
    entry_premium?: number | null;
    exit_style?: string | null;
  } | null;
};

function readString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function readPremium(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function legacyPublishFieldsFrom(source: LegacyPublishFieldSource): {
  options_play: string | null;
  entry_premium: number | null;
  exit_style: "scale_out" | null;
} {
  const ctx = source.publish_context ?? null;
  const finalOut =
    ctx && typeof ctx.final_output === "object" && ctx.final_output != null
      ? (ctx.final_output as Record<string, unknown>)
      : null;

  const options_play =
    readString(finalOut?.options_play) ??
    readString(ctx?.options_play) ??
    readString(source.editionPlay?.options_play);

  const entry_premium =
    readPremium(finalOut?.entry_premium) ??
    readPremium(ctx?.entry_premium) ??
    readPremium(source.editionPlay?.entry_premium);

  const exitRaw = finalOut?.exit_style ?? ctx?.exit_style ?? source.editionPlay?.exit_style;
  const exit_style = exitRaw === "scale_out" ? "scale_out" : null;

  return { options_play, entry_premium, exit_style };
}
