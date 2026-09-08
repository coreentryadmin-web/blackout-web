/**
 * Resolve and validate the audit target origin. Audit scripts accept --base= or
 * VALIDATE_BASE, but the value must stay on our production host — never pass
 * arbitrary user input through to spawn/fetch without this guard.
 */
export function resolveAuditBase(raw) {
  const base = String(raw ?? process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`Invalid audit base URL: ${base}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Audit base must be https (got ${url.protocol})`);
  }
  if (url.hostname !== "blackouttrades.com" && !url.hostname.endsWith(".blackouttrades.com")) {
    throw new Error(`Audit base host not allowed: ${url.hostname}`);
  }
  return base;
}

/** Safe artifact filename segment — strips anything that could confuse spawn args. */
export function safeArtifactSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}
