#!/usr/bin/env node
/** Quick prod probe: is brief v4 collapse live on OPEN play? */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const COLLAPSED = new Set([
  "Hold plan",
  "GEX posture",
  "Flow & positioning",
  "Levels on chart",
  "Vector desk",
]);

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE, publicMetadata: { tier: "premium" } });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(2);
  }
  const url =
    `${BASE}/api/market/swing/play-brief?playId=SWING%3ANRG%3A34&ticker=NRG&positionId=34&status=HOLD&strike=110&right=C`;
  const res = await fetch(url, { headers: { Cookie: session.cookieHeader }, cache: "no-store" });
  const json = await res.json();
  const sections = json.envelope?.sections?.map((s) => s.title) ?? [];
  const narrative = json.envelope?.sections?.find((s) => s.title === "Trade manager read");
  const folded = /folded into Trade manager read/i.test(narrative?.body ?? "");
  const stillHasCollapsed = sections.filter((t) => COLLAPSED.has(t));
  const v4Live = stillHasCollapsed.length === 0 && folded;
  console.log(JSON.stringify({ v4Live, sections, stillHasCollapsed, folded, briefContentKey: json.briefContentKey }, null, 2));
  await session.cleanup();
  process.exit(v4Live ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
