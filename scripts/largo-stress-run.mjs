#!/usr/bin/env node
/**
 * Largo stress run — router (local) + optional live staging answers.
 *
 *   node scripts/largo-stress-run.mjs                    # bank 1 only (legacy default)
 *   LARGO_STRESS_BANK=all node scripts/largo-stress-run.mjs   # all ~400+ questions
 *   LARGO_STRESS_BANK=2,3 node scripts/largo-stress-run.mjs     # subset
 *   LARGO_STRESS_LIVE=1 LARGO_STRESS_BANK=all ...       # live HTTP against PRODUCTION
 *
 * TARGET CORRECTED 2026-08-11. The live half defaulted to `staging.blackouttrades.com`, which was
 * DECOMMISSIONED on 2026-07-25 — ECS, RDS, Cognito, ALB and DNS are all gone. So every live run
 * since then reached nothing and the suite reported `live_ok: 0` while the router pass still
 * printed a clean result. "Answer quality is measured" was never true. A harness pointed at a dead
 * host does not fail loudly; it just stops measuring.
 *
 * Production is the only environment now, so that is the default.
 *
 * Env:
 *   LARGO_STRESS_BANK — 1 | 2 | 3 | all | comma list (default: 1)
 *   LARGO_STRESS_LIVE — 1 to POST each question to live Largo
 *   LARGO_STRESS_CONCURRENCY — parallel live requests (default 1)
 *   LARGO_STRESS_LIMIT — cap questions (debug)
 *   LARGO_BASE_URL — default https://blackouttrades.com
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scoreAnswer } from "./largo-stress-scoring.mjs";
import { loadStressBank, bankStats } from "./largo-stress-banks.mjs";
import { classifyBieIntent, classifyBieStagingFallback } from "../src/lib/bie/router.ts";
import { isCompoundQuestion } from "../src/lib/bie/decompose.ts";

const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const bankSpec = process.env.LARGO_STRESS_BANK ?? "1";
const STRESS_BANK = loadStressBank(bankSpec);
const limit = process.env.LARGO_STRESS_LIMIT ? Number(process.env.LARGO_STRESS_LIMIT) : null;
const entries = limit != null && Number.isFinite(limit) ? STRESS_BANK.slice(0, limit) : STRESS_BANK;

const stats = bankStats();
console.log(`Banks: ${JSON.stringify(stats)} | running: ${entries.length} (spec=${bankSpec})`);

function routeQuestion(q) {
  const ledger = new Set([
    "TSLA", "NVDA", "SPY", "AAPL", "META", "PLTR", "XLF", "GLD", "COIN", "AMD", "AMZN", "MSFT", "QQQ", "IWM",
  ]);
  if (isCompoundQuestion(q)) return { intent: "compound_lookup", ticker: null };
  return classifyBieIntent(q, ledger) ?? classifyBieStagingFallback(q);
}


const PRODUCTION_BASE = "https://blackouttrades.com";
const DECOMMISSIONED_HOST = "staging.blackouttrades.com";

/**
 * Exact host match, by PARSING the URL rather than pattern-matching the string.
 *
 * The first version tested `/staging\.blackouttrades\.com/` against the raw value, which CodeQL
 * correctly flagged: an unanchored expression matches anywhere in a URL, so
 * `https://evil.com/?x=staging.blackouttrades.com` and `https://staging.blackouttrades.com.other/`
 * both pass. Anchoring the regex would have patched the symptom; comparing the parsed `hostname`
 * removes the class — there is no string position left to smuggle a host through.
 *
 * An unparseable value is NOT the decommissioned host, and is left for the caller to handle.
 */
function hostIs(value, host) {
  try {
    return new URL(value).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * The live target. Production by default — staging no longer exists.
 *
 * A stale `STAGING_BASE_URL` in a shell would silently re-point this at the dead host, so it is
 * honoured (nothing breaks) and warned about (nothing is silent).
 */
function liveBaseUrl() {
  const legacy = process.env.STAGING_BASE_URL;
  if (legacy && hostIs(legacy, DECOMMISSIONED_HOST)) {
    console.warn(
      `[largo-stress] STAGING_BASE_URL points at ${DECOMMISSIONED_HOST}, decommissioned 2026-07-25 — using production.`
    );
    return PRODUCTION_BASE;
  }
  return (process.env.LARGO_BASE_URL ?? legacy ?? PRODUCTION_BASE).replace(/\/$/, "");
}

async function askLive(cookieHeader, question) {
  const { fetchRetry } = await import("./audit/lib/fetch-retry.mjs");
  const BASE = liveBaseUrl();
  const t0 = Date.now();
  const res = await fetchRetry(
    `${BASE}/api/market/largo/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ question, session_id: `stress-${Date.now()}` }),
    },
    { retries: 1, timeoutMs: 120_000 }
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, answer: body?.answer ?? "", source: body?.source, ms: Date.now() - t0 };
}

/**
 * A NON-200 IS NOT AN ANSWER-QUALITY SIGNAL, and scoring it as one corrupts the measurement.
 *
 * The first production run returned 429 for 9 of 12 questions at concurrency 3 and the scorer
 * recorded them as WARN / "too-short" — a throttled empty body IS short. Read at face value that
 * says Largo answers badly; it says the harness asked too fast. The next run hit 401s halfway
 * through, when the temp session aged out, and produced the same false signal. A suite that cannot
 * separate "the system is wrong" from "I never asked it" measures nothing.
 *
 * So throttled questions are retried with backoff, and anything that is not a 200 is reported as
 * SKIPPED and excluded from the quality tally rather than counted against it.
 */
async function askLiveThrottleAware(cookieHeader, question, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await askLive(cookieHeader, question);
    if (last.status !== 429) return last;
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return { ...last, throttled: true };
}

const rows = [];
for (const entry of entries) {
  const route = routeQuestion(entry.q);
  rows.push({ q: entry.q, intent: route?.intent ?? null, ticker: route?.ticker ?? null });
}

const routerBad = entries.filter((e, i) => {
  const r = { intent: rows[i].intent };
  const fake = scoreAnswer(e, r, "x".repeat(100), 200);
  return fake.issues.some((x) => x.startsWith("intent"));
});

console.log(`\n=== Router pass (${entries.length} questions) ===`);
console.log(`Intent mismatches: ${routerBad.length}`);
for (const e of routerBad.slice(0, 40)) {
  const i = entries.indexOf(e);
  console.log(`  ✗ [${rows[i].intent}] ${e.q.slice(0, 72)}`);
}
if (routerBad.length > 40) console.log(`  … and ${routerBad.length - 40} more`);

let liveRows = [];
if (process.env.LARGO_STRESS_LIVE === "1") {
  const { mintAppSession } = await import("./audit/lib/app-session.mjs");
  const BASE = liveBaseUrl();
  const session = await mintAppSession({ appUrl: BASE });
  if (session.skip) {
    console.error("Live auth skip:", session.reason);
  } else {
    /**
     * SESSION REFRESH — the token, not the user.
     *
     * ROOT CAUSE OF THE COVERAGE CAP, and the previous fix here treated the symptom. The minted
     * `__session` JWT has a MEASURED ~72s fixed lifetime (see `prod-clerk-session.mjs`) — not an
     * idle timeout, so a busy sweep dies just as fast as a slow one. Roughly seven questions in.
     *
     * The old recovery re-ran `mintAppSession`: a whole new temp Clerk user plus a fresh
     * `sign_in_tokens` ticket exchange. That IS the FAPI path CLAUDE.md caps ("authenticate once
     * per run"), which is why it had to be limited to 2 — and two re-mints times seven questions
     * is the ~16-22 of 523 ceiling every sweep hit. The cap was load-bearing on the wrong lever.
     *
     * `session.refresh()` re-mints only the JWT, re-using the EXISTING session's cookies. It is
     * the same call the browser's Clerk client makes on a timer, it does not create a user, and it
     * is not the rate-limited sign-in flow. So it can run for the whole sweep and the coverage
     * ceiling disappears.
     *
     * Refreshed PROACTIVELY at 45s (comfortably inside 72s) rather than reactively on 401, because
     * a reactive-only scheme spends one wasted request per token generation and, at concurrency>1,
     * spends one per in-flight worker. Reactive refresh is KEPT as a backstop for the case where a
     * request is issued just before expiry and lands just after.
     *
     * Serialised behind one in-flight promise so concurrent workers share a single refresh instead
     * of stampeding.
     */
    let live = session;
    let refreshes = 0;
    let refreshing = null;
    let tokenMintedAt = Date.now();
    const TOKEN_MAX_AGE_MS = 45_000;

    async function refreshSession() {
      if (!session.refresh) return false;
      if (!refreshing) {
        refreshing = (async () => {
          const next = await session.refresh().catch(() => null);
          if (next) {
            live = { ...live, cookieHeader: next.cookieHeader };
            tokenMintedAt = Date.now();
            refreshes += 1;
          }
          refreshing = null;
          return Boolean(next);
        })();
      }
      return refreshing;
    }

    /** Refresh before a request when the current token is close to its measured lifetime. */
    async function freshCookie() {
      if (Date.now() - tokenMintedAt > TOKEN_MAX_AGE_MS) await refreshSession();
      return live.cookieHeader;
    }

    const concurrency = Math.max(1, Number(process.env.LARGO_STRESS_CONCURRENCY) || 1);
    console.log(`\n=== Live (${BASE}) concurrency=${concurrency} ===\n`);
    try {
      let idx = 0;
      async function worker() {
        while (idx < entries.length) {
          const i = idx++;
          const entry = entries[i];
          let res = await askLiveThrottleAware(await freshCookie(), entry.q);
          if (res.status === 401) {
            // LOGGED UNCONDITIONALLY, because the first version of this was silent and I could
            // not tell whether it had run. The one sweep that should have exercised it answered
            // 16 questions, hit a hard 401 wall, and printed nothing — leaving "the recovery
            // works" unverifiable. A recovery path that cannot be seen firing is indistinguishable
            // from one that is not wired.
            console.log(`[largo-stress] 401 on "${entry.q.slice(0, 40)}" — refreshing session token`);
            const ok = await refreshSession();
            console.log(`[largo-stress] refresh ${ok ? "succeeded, retrying" : "unavailable"}`);
            if (ok) res = await askLiveThrottleAware(live.cookieHeader, entry.q);
          }
          const { status, answer, source, ms, throttled } = res;
          const route = { intent: rows[i].intent };
          // ONLY A 200 IS SCORED FOR QUALITY — everything else is a transport outcome.
          const scored =
            throttled || status !== 200
              ? { verdict: "SKIP", issues: [`http-${status} — transport, excluded from the quality tally`] }
              : scoreAnswer(entry, route, answer, status);
          liveRows.push({
            ...entry,
            status,
            source,
            ms,
            answer_len: answer.length,
            ...scored,
            preview: answer.slice(0, 120),
          });
          const icon =
            scored.verdict === "OK" ? "✓" : scored.verdict === "WARN" ? "⚠" : scored.verdict === "SKIP" ? "–" : "✗";
          console.log(`${icon} ${ms}ms ${scored.verdict} | ${entry.q.slice(0, 55)}`);
          if (scored.issues.length) console.log(`    ${scored.issues.join(", ")}`);
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      // Surfaced because a sweep that ran long with ZERO refreshes means the refresh path never
      // fired, which is how the old cap went unnoticed for as long as it did.
      console.log(`\n[largo-stress] session token refreshed ${refreshes}×`);
      liveRows.sort((a, b) => entries.findIndex((e) => e.q === a.q) - entries.findIndex((e) => e.q === b.q));
    } finally {
      await session.cleanup?.();
    }
  }
}

const summary = {
  bank_spec: bankSpec,
  bank_stats: stats,
  total: entries.length,
  router_mismatch: routerBad.length,
  live_ok: liveRows.filter((r) => r.verdict === "OK").length,
  live_bad: liveRows.filter((r) => r.verdict === "BAD").length,
  live_warn: liveRows.filter((r) => r.verdict === "WARN").length,
  /** Reported so a run that measured little cannot be read as a run that went well. */
  live_skipped_transport: liveRows.filter((r) => r.verdict === "SKIP").length,
  /** OK / (OK + WARN + BAD) — quality over questions that were actually ANSWERED. */
  live_quality_pct: (() => {
    const scored = liveRows.filter((r) => r.verdict !== "SKIP");
    return scored.length
      ? Math.round((scored.filter((r) => r.verdict === "OK").length / scored.length) * 1000) / 10
      : null;
  })(),
};

const reportName =
  bankSpec === "1" ? "largo-stress-report.json" : `largo-stress-report-${bankSpec.replace(/[^a-z0-9]+/gi, "-")}.json`;

writeFileSync(join(OUT, reportName), JSON.stringify({ at: new Date().toISOString(), summary, router: rows, live: liveRows }, null, 2));
console.log(`\nWrote audit-output/${reportName}`);
console.log(JSON.stringify(summary, null, 2));

if (routerBad.length > 0 && process.env.LARGO_STRESS_ALLOW_ROUTER_FAIL !== "1") {
  process.exit(1);
}
// A run that stops measuring partway is not a clean run, however good the answered subset looks.
if (summary.live_skipped_transport > 0) {
  console.warn(
    `\n[largo-stress] ${summary.live_skipped_transport} question(s) were never answered (transport). ` +
      `live_quality_pct describes only the ${summary.total - summary.live_skipped_transport} that were.`
  );
}

if (summary.live_bad > 0) {
  process.exit(1);
}
