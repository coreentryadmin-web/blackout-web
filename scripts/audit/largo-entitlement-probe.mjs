#!/usr/bin/env node
/**
 * LARGO ENTITLEMENT PROBE — can a non-admin member reach Largo?
 *
 * Largo is meant to be admin-only right now (`tool-access.ts`: largo `defaultLaunched: false`).
 * This proves it against PRODUCTION with real credentials, for each tier that matters.
 *
 * WHY BOTH SURFACES ARE CHECKED, AND WHY THE API IS THE REAL ONE. A hidden nav link is not a
 * security boundary — anyone can type /terminal, and anyone can POST to the API directly. If the
 * UI hides Largo but `POST /api/market/largo/query` answers for a community member, Largo is NOT
 * admin-only; it is admin-only-looking, and the difference is a bill and a data-exposure surface.
 * So the API result is the verdict and the page result is context.
 *
 * READ-ONLY. Mints one temp Clerk user per tier, asks Largo one trivial question, deletes the user
 * in a `finally`. Never prints secrets or cookies.
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-entitlement-probe.mjs [--base=https://blackouttrades.com]
 *
 * Exits non-zero if any non-admin tier can reach Largo.
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = process.argv.slice(2);
const BASE = ((args.find((a) => a.startsWith("--base=")) || "").split("=")[1] || "https://blackouttrades.com").replace(/\/$/, "");

/** Each tier gets its OWN e-mail — Clerk enforces uniqueness, so they cannot share one. */
const SUBJECTS = [
  { label: "community (non-admin)", meta: { tier: "community" }, email: "claude-audit-community@blackouttrades.com", shouldReach: false },
  { label: "premium (non-admin)", meta: { tier: "premium" }, email: "claude-audit-premium@blackouttrades.com", shouldReach: false },
  { label: "admin", meta: { role: "admin", tier: "premium" }, email: "claude-audit-adminchk@blackouttrades.com", shouldReach: true },
];

const rows = [];

for (const s of SUBJECTS) {
  const session = await mintClerkPremiumSession({ appUrl: BASE, publicMetadata: s.meta, email: s.email });
  if (!session || session.skip) {
    console.error(`SKIP ${s.label}: ${session?.reason ?? "no session"}`);
    process.exit(2);
  }
  try {
    const cookie = await session.cookieHeader;

    // THE VERDICT: the API. A hidden link is not a boundary.
    const api = await fetch(`${BASE}/api/market/largo/query`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ question: "SPX?", session_id: `entitlement-${Date.now()}` }),
    });
    const body = await api.json().catch(() => ({}));
    const answered = api.status === 200 && typeof body.answer === "string" && body.answer.length > 0;

    // CONTEXT: the page. Served HTML only — whether the client then hides a panel is a separate
    // question this cannot see, which is exactly why the API is the verdict.
    const page = await fetch(`${BASE}/terminal`, { headers: { cookie } });
    const html = await page.text();
    const pageMentionsLargo = /largo/i.test(html);
    const pageLooksGated = /upgrade|not available|no access|admin only|coming soon/i.test(html);

    rows.push({
      subject: s.label,
      shouldReach: s.shouldReach,
      apiStatus: api.status,
      answered,
      pageStatus: page.status,
      pageMentionsLargo,
      pageLooksGated,
    });
  } finally {
    await session.release?.().catch(() => {});
  }
}

console.log(`\nLARGO ENTITLEMENT — ${BASE}\n${"=".repeat(78)}`);
for (const r of rows) {
  const ok = r.answered === r.shouldReach;
  console.log(
    `[${ok ? "OK  " : "FAIL"}] ${r.subject.padEnd(22)} api=${r.apiStatus} answered=${r.answered ? "YES" : "no"} ` +
      `page=${r.pageStatus} mentionsLargo=${r.pageMentionsLargo} gatedCopy=${r.pageLooksGated}`
  );
}

const leaks = rows.filter((r) => !r.shouldReach && r.answered);
const adminBlocked = rows.filter((r) => r.shouldReach && !r.answered);

console.log("");
if (leaks.length) {
  console.log("LEAK — a non-admin member got a Largo answer from the API:");
  for (const l of leaks) console.log(`  - ${l.subject} (HTTP ${l.apiStatus})`);
  console.log("\nHiding the nav link does not fix this. The API is the boundary.");
} else {
  console.log("No non-admin tier could get an answer from the Largo API.");
}
if (adminBlocked.length) {
  console.log("\nNOTE: admin could NOT reach Largo either — the gate may be off entirely, or the");
  console.log("probe is broken. A pass here means nothing until admin is confirmed working.");
}

process.exit(leaks.length || adminBlocked.length ? 1 : 0);
