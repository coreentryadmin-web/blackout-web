#!/usr/bin/env node
/**
 * Launch site-wide RTH Cloud Agent (continuous monitor + cross-tool fixes).
 * Requires: CURSOR_API_KEY
 */
const REPO = "https://github.com/coreentryadmin-web/blackout-web";
const apiKey = process.env.CURSOR_API_KEY?.trim();
if (!apiKey) {
  console.log("[site-agent] CURSOR_API_KEY unset — skip");
  process.exit(0);
}

const PROMPT = [
  "You are the BlackOut **site-wide RTH supervisor** Cloud Agent.",
  "Read docs/ops/RTH-CONTINUOUS-MONITOR.md and docs/ops/RTH-OPEN-RUNBOOK.md.",
  "At 09:30 ET start and run ALL DAY until 16:00 ET:",
  "1. npm run validate:rth-continuous (never stop on P1 — log and fix)",
  "2. npm run validate:rth-sweep at 09:35, 11:00, 13:00, 15:00",
  "3. On ANY P1: diagnose → fix → branch → PR → gh pr merge --auto --squash → poll deploy → re-validate → CONTINUE monitoring",
  "4. Never ask the user. Never stop for permission. Auto-merge when CI green per CLAUDE.md.",
  "5. Append session notes to docs/api-audit/OPEN-ISSUES.md",
].join(" ");

const payload = JSON.stringify({
  prompt: { text: PROMPT },
  repos: [{ url: REPO, startingRef: "main" }],
  autoCreatePR: true,
});

const res = await fetch("https://api.cursor.com/v1/agents", {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    "Content-Type": "application/json",
  },
  body: payload,
});
const text = await res.text();
if (!res.ok) {
  console.error(`[site-agent] launch failed ${res.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}
console.log(`[site-agent] launched: ${text.slice(0, 200)}`);
