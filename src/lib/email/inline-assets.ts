import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Brand/product images for lifecycle emails, embedded as real inline (CID)
 * attachments rather than referenced by hosted URL. Two reasons: (1) a
 * hosted-URL image only renders once it's actually deployed to production —
 * a feature branch's new assets 404 until merge, which is invisible until
 * someone actually opens a test send; (2) most mail clients render inline
 * attachments immediately even when "load remote images" is off, which a
 * meaningful share of recipients leave off by default. Read once per file
 * (module-level cache — these never change at runtime) and reused across
 * every send.
 */
export type InlineAsset = {
  filename: string;
  contentId: string;
  contentType: string;
  content: Buffer;
};

const cache = new Map<string, InlineAsset>();

function loadAsset(relPath: string, contentId: string, contentType: string): InlineAsset {
  const cached = cache.get(contentId);
  if (cached) return cached;
  const content = readFileSync(join(process.cwd(), "public", relPath));
  const asset: InlineAsset = { filename: relPath.split("/").pop()!, contentId, contentType, content };
  cache.set(contentId, asset);
  return asset;
}

export function logoAsset(): InlineAsset {
  return loadAsset("icon-192.png", "blackout-logo", "image/png");
}
export function discordBadgeAsset(): InlineAsset {
  return loadAsset("images/email/discord-badge.png", "discord-badge", "image/png");
}
export function xBadgeAsset(): InlineAsset {
  return loadAsset("images/email/x-badge.png", "x-badge", "image/png");
}
export function thermalKeyLevelsAsset(): InlineAsset {
  return loadAsset("images/email/thermal-key-levels.jpg", "thermal-key-levels", "image/jpeg");
}
export function spxDeskHeroAsset(): InlineAsset {
  return loadAsset("images/email/spx-desk-hero.jpg", "spx-desk-hero", "image/jpeg");
}
export function vectorChartAsset(): InlineAsset {
  return loadAsset("images/email/vector-chart.jpg", "vector-chart", "image/jpeg");
}

/** The chrome (header logo + footer Discord/X badges) every email uses. */
export function chromeAssets(): InlineAsset[] {
  return [logoAsset(), discordBadgeAsset(), xBadgeAsset()];
}

export function cidSrc(asset: InlineAsset): string {
  return `cid:${asset.contentId}`;
}
