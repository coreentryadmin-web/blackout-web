#!/usr/bin/env node
/**
 * Live Largo social / X post validation — multiple scenarios against production.
 *
 *   node scripts/validate-largo-social.mjs
 *   LARGO_BASE_URL=https://blackouttrades.com node scripts/validate-largo-social.mjs
 *
 * Requires CLERK_SECRET_KEY (+ publishable key). Exits non-zero on any RED scenario.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreSocialAnswer } from "../src/lib/largo/social-answer-quality.ts";
import { formatLargoXPost } from "../src/lib/largo/format-x-post.ts";
import { detectSocialArchetype } from "../src/lib/largo/social-content-core.ts";

const BASE = (process.env.LARGO_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const SCENARIOS = [
  {
    id: "x-winners",
    label: "X · today's winners",
    question:
      "Draft an X post about today's winning 0DTE plays — hook, tweet copy, alt hooks, CTA, and exactly which desk screenshots to attach. Use only live board numbers.",
    expectArchetype: "win_recap",
    expectTools: ["Night Hawk", "Helix"],
  },
  {
    id: "x-platform",
    label: "X · platform showcase",
    question:
      "Draft an X post showcasing the BlackOut desk — what makes it different, one provocative hook, tweet copy, CTA, and which tool screenshots to attach.",
    expectArchetype: "platform_showcase",
    expectTools: ["Vector", "Helix", "Thermal"],
  },
  {
    id: "x-spx-desk",
    label: "X · SPX live read",
    question:
      "Draft an X post for the current SPX setup — flip, walls, flow vs gamma, tweet copy, CTA, and screenshot list.",
    expectArchetype: "live_desk",
    expectTools: ["Thermal", "Helix"],
  },
  {
    id: "x-meridian-earnings",
    label: "X · earnings catalyst",
    question:
      "Draft an X post for the next high-impact earnings name on Meridian — copy, CTA, Whop/pricing mention when appropriate, and step-by-step screenshots from Meridian, Helix, and Thermal.",
    expectArchetype: "earnings_catalyst",
    expectTools: ["Meridian", "Helix"],
  },
  {
    id: "x-full-workflow",
    label: "X · full screenshot guide",
    question:
      "I'm posting on X today — give me tweet copy AND a complete screenshot workflow: Helix filters, Thermal (Mag7 if relevant), Vector, Night Hawk plays, with exact clicks and what to capture from each tool.",
    expectArchetype: "platform_showcase",
    expectTools: ["Helix", "Thermal"],
  },
];

async function askLargo(cookieHeader, question) {
  const { fetchRetry } = await import("./audit/lib/fetch-retry.mjs");
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}/api/market/largo/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ question, session_id: `social-val-${Date.now()}` }),
    },
    { retries: 2, timeoutMs: 180_000 },
  );
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    answer: String(body?.answer ?? ""),
    ms: Date.now() - t0,
  };
}

async function draftXPost(cookieHeader, payload) {
  const res = await fetch(`${BASE}/api/market/largo/draft-x-post`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status, draft: await res.json() };
}

function worst(a, b) {
  const rank = { GREEN: 0, AMBER: 1, RED: 2 };
  return rank[a] >= rank[b] ? a : b;
}

async function main() {
  const { mintAppSession } = await import("./audit/lib/app-session.mjs");
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(0);
  }

  let live = session;
  let tokenMintedAt = Date.now();
  const TOKEN_MAX_AGE_MS = 45_000;

  async function ensureFresh() {
    if (Date.now() - tokenMintedAt < TOKEN_MAX_AGE_MS) return;
    if (!session.refresh) return;
    const next = await session.refresh().catch(() => null);
    if (next) {
      live = { ...live, cookieHeader: next.cookieHeader };
      tokenMintedAt = Date.now();
    }
  }

  const results = [];
  let rollup = "GREEN";

  console.log(`\n=== Largo social validation (${SCENARIOS.length} scenarios) @ ${BASE} ===\n`);

  for (const scenario of SCENARIOS) {
    await ensureFresh();
    process.stdout.write(`→ ${scenario.label} … `);
    const { status, answer: rawAnswer, ms } = await askLargo(live.cookieHeader, scenario.question);

    if (status !== 200) {
      console.log(`HTTP ${status}`);
      results.push({ ...scenario, http: status, verdict: "RED", issues: [`http-${status}`] });
      rollup = worst(rollup, "RED");
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const { enrichSocialAnswerIfNeeded } = await import("../src/lib/largo/social-answer-enrich.ts");
    const answer = enrichSocialAnswerIfNeeded(rawAnswer, scenario.question, null, "SPX");

    const score = scoreSocialAnswer(answer);
    const archetype = detectSocialArchetype(scenario.question);
    const draft = formatLargoXPost({
      answer,
      question: scenario.question,
      archetype,
    });

    const draftApi = await draftXPost(live.cookieHeader, {
      answer,
      question: scenario.question,
    });
    if (draftApi.status === 401 && session.refresh) {
      await ensureFresh();
      const retry = await draftXPost(live.cookieHeader, { answer, question: scenario.question });
      Object.assign(draftApi, retry.ok ? { ok: true, draft: retry.draft } : retry);
    }

    const issues = [...score.issues];
    if (archetype !== scenario.expectArchetype && scenario.expectArchetype !== "live_desk") {
      issues.push(`archetype-got-${archetype}-want-${scenario.expectArchetype}`);
    }
    for (const tool of scenario.expectTools) {
      if (!draft.attachments.some((a) => a.tool === tool)) {
        issues.push(`draft-missing-${tool.replace(/\s+/g, "-").toLowerCase()}`);
      }
    }
    if (!draftApi.ok) issues.push(`draft-api-${draftApi.status ?? "err"}`);
    if (draft.attachments.some((a) => !a.steps?.length)) issues.push("attachment-missing-steps");
    if (draft.charCount > 280) issues.push("tweet-over-280");

    let verdict = score.verdict;
    if (issues.some((i) => i.startsWith("draft-api") || i.startsWith("http-"))) verdict = "RED";
    else if (issues.length > score.issues.length || score.verdict === "AMBER") verdict = "AMBER";
    if (verdict === "RED" || (score.verdict === "RED" && issues.length === score.issues.length)) {
      verdict = score.verdict === "RED" ? "RED" : verdict;
    }

    rollup = worst(rollup, verdict);
    console.log(`${verdict} (${ms}ms, ${draft.attachments.length} attachments, copy ${score.copyLength ?? "—"} chars)`);
    if (issues.length) console.log(`   issues: ${issues.join(", ")}`);

    results.push({
      id: scenario.id,
      label: scenario.label,
      verdict,
      ms,
      archetype,
      score,
      draft: {
        charCount: draft.charCount,
        attachmentTools: draft.attachments.map((a) => a.tool),
        stepCounts: draft.attachments.map((a) => a.steps?.length ?? 0),
      },
      issues,
      answerPreview: answer.slice(0, 400),
    });

    await new Promise((r) => setTimeout(r, 4000));
  }

  const outPath = join(OUT, `largo-social-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify({ base: BASE, rollup, results }, null, 2));
  console.log(`\nRollup: ${rollup} — wrote ${outPath}\n`);

  try {
    await session.cleanup?.();
  } catch {
    /* ignore */
  }

  process.exit(rollup === "RED" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
