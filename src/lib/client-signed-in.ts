/** Clerk `__client_uat` — non-httpOnly session signal for CDN/SSR chrome healing. */
export function readClientSignedIn(): boolean | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)__client_uat=([^;]+)/);
  if (!m) return null;
  const v = parseInt(decodeURIComponent(m[1]), 10);
  return Number.isFinite(v) && v > 0;
}

/** Prefer live cookie over SSR guess so the first client paint matches session state. */
export function resolveClientSignedIn(serverSignedIn: boolean): boolean {
  const client = readClientSignedIn();
  if (client !== null) return client;
  return serverSignedIn;
}
