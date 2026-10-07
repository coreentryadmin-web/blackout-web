#!/usr/bin/env node
/**
 * LARGO SWING PLAY-BRIEF CONTRACT AUDIT
 *
 * Validates GET /api/market/swing/play-brief envelopes against
 * docs/audit/LARGO-PRODUCT-CONTRACT.md ten-point specification.
 *
 * Focus: the standing Ask Largo ownership mandate's requirement to check
 * envelope completeness vs the contract's ten points, dead-wired data,
 * and narrative-vs-bullet-dump quality.
 *
 * This audits what PR #5620 missed: structural and narrative layers
 * contradicting each other on contract-defined facts (C2 freshness,
 * C3 absence, C7 evidence coherence).
 *
 * Usage:
 *   node --import tsx scripts/audit/largo-swing-brief-contract-audit.mjs [--json] [--sample=N] [--tickers=A,B,C]
 *
 * Env:
 *   VALIDATE_BASE — prod by default (https://blackouttrades.com)
 *   POLYGON_API_KEY, POLYGON_API_BASE — for optional data validation
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { fetchRetry } from "./lib/fetch-retry.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const SAMPLE = Number((args.find((a) => a.startsWith("--sample=")) || "").split("=")[1] || 0);
const TICKERS_ARG = (args.find((a) => a.startsWith("--tickers=")) || "").split("=")[1]?.split(",").filter(Boolean) || [];

// Live tickers to audit — sampling if SAMPLE > 0
const LIVE_SAMPLE_TICKERS = [
  "TSLA", "NVDA", "SPY", "AAPL", "META", "PLTR", "XLF", "GLD", "COIN", "AMD",
  "AMZN", "MSFT", "QQQ", "IWM", "MSTR", "NTAP", "RIOT", "BKKT", "IREN", "HOOD",
];
const TICKERS = TICKERS_ARG.length > 0 ? TICKERS_ARG : (SAMPLE > 0 ? LIVE_SAMPLE_TICKERS.slice(0, SAMPLE) : LIVE_SAMPLE_TICKERS);

/**
 * CONTRACT AUDIT: C1 TIME
 * Every tool result carries as_of: "YYYY-MM-DD HH:mm ET"
 */
function auditC1Time(envelope) {
  const findings = [];
  const as_of = envelope?.as_of;

  if (!as_of) {
    findings.push({ code: "C1-missing-as_of", severity: "RED", detail: "envelope.as_of missing" });
  } else if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET$/.test(as_of)) {
    findings.push({ code: "C1-malformed-as_of", severity: "RED", detail: `as_of format invalid: ${as_of}` });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C2 FRESHNESS
 * freshness: "live" | "delayed" | "cached" | "snapshot" | "stale"
 * age_seconds: number | null
 *
 * CRITICAL: Narrative and structured freshness must agree
 */
function auditC2Freshness(envelope) {
  const findings = [];
  const freshness = envelope?.freshness;

  if (!freshness) {
    findings.push({ code: "C2-missing-freshness", severity: "RED", detail: "envelope.freshness missing" });
  } else if (!["live", "delayed", "cached", "snapshot", "stale"].includes(freshness)) {
    findings.push({ code: "C2-invalid-freshness-value", severity: "RED", detail: `freshness value invalid: ${freshness}` });
  }

  // Check narrative/structured alignment on staleness
  const narrativeText = envelope?.narrative_sections?.find(s => s.title?.includes("freshness") || s.body?.includes("stale"))?.body || "";
  const isNarrativeStale = /\b(stale|delayed|lag)\b/i.test(narrativeText);
  const isStructuredStale = freshness === "stale" || freshness === "delayed";

  if (isNarrativeStale !== isStructuredStale) {
    findings.push({
      code: "C2-narrative-structured-mismatch",
      severity: "RED",
      detail: `Narrative says stale=${isNarrativeStale}, structured says ${freshness}. Must agree.`,
      narrative_excerpt: narrativeText.slice(0, 100),
    });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C3 ABSENCE
 * Never return [] / null / {} for "unavailable".
 * unavailable: { reason: string; what_is_missing: string; retryable: boolean }
 *
 * CRITICAL: Absence must be explicitly structured
 */
function auditC3Absence(envelope) {
  const findings = [];
  const unavail = envelope?.unavailableSources;

  // unavailableSources is a list of {code, reason, what_is_missing} objects
  if (unavail && Array.isArray(unavail)) {
    unavail.forEach((item, i) => {
      if (!item.code || !item.reason || item.what_is_missing === undefined) {
        findings.push({
          code: "C3-incomplete-absence-structure",
          severity: "RED",
          detail: `unavailableSources[${i}] missing required fields. Has: ${Object.keys(item).join(", ")}`,
        });
      }
    });
  }

  // Check narrative doesn't claim data missing while structured says it's available
  const narrativeText = (envelope?.narrative_sections || []).map(s => s.body || "").join(" ");
  const isNarrativeUnavailable = /\b(unavailable|missing|unable|cannot access)\b/i.test(narrativeText);
  const isStructuredUnavailable = unavail && unavail.length > 0;

  if (isNarrativeUnavailable !== isStructuredUnavailable) {
    findings.push({
      code: "C3-narrative-structured-mismatch",
      severity: "RED",
      detail: `Narrative says unavailable=${isNarrativeUnavailable}, structured has ${unavail?.length || 0} unavailable sources. Must agree.`,
    });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C4 IDENTITY
 * ticker: string (uppercase canonical root: "SPX", never "I:SPX" or "SPXW")
 * ticker_class: "index" | "equity" | "etf"
 */
function auditC4Identity(envelope) {
  const findings = [];
  const ticker = envelope?.ticker;
  const ticker_class = envelope?.ticker_class;

  if (!ticker) {
    findings.push({ code: "C4-missing-ticker", severity: "RED", detail: "envelope.ticker missing" });
  } else if (!/^[A-Z]+$/.test(ticker)) {
    findings.push({ code: "C4-non-uppercase-ticker", severity: "RED", detail: `ticker not uppercase: ${ticker}` });
  } else if (ticker.includes("I:") || ticker.includes("W")) {
    findings.push({ code: "C4-non-canonical-ticker", severity: "AMBER", detail: `ticker may not be canonical root: ${ticker}` });
  }

  if (!ticker_class) {
    findings.push({ code: "C4-missing-ticker-class", severity: "RED", detail: "envelope.ticker_class missing" });
  } else if (!["index", "equity", "etf"].includes(ticker_class)) {
    findings.push({ code: "C4-invalid-ticker-class", severity: "RED", detail: `ticker_class invalid: ${ticker_class}` });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C5 DIRECTION
 * direction: "bullish" | "bearish" | "neutral"
 * Keep product's native richer notion alongside it
 */
function auditC5Direction(envelope) {
  const findings = [];
  const direction = envelope?.direction;

  if (!direction) {
    findings.push({ code: "C5-missing-direction", severity: "AMBER", detail: "envelope.direction missing (may be unavailable)" });
  } else if (!["bullish", "bearish", "neutral"].includes(direction)) {
    findings.push({ code: "C5-invalid-direction", severity: "RED", detail: `direction invalid: ${direction}` });
  }

  // Check for raw signs (positive/negative/plus/minus)
  const narrativeText = (envelope?.narrative_sections || []).map(s => s.body || "").join(" ");
  if (/\b([+-]\d+%|positive|negative|[+−])\b/.test(narrativeText) && direction) {
    // This is OK — product's richer notion alongside labeled direction
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C6 CONFIDENCE
 * confidence?: { score: number; basis: string; sample_size: number | null }
 * OMIT if not calibrated — never fabricate
 */
function auditC6Confidence(envelope) {
  const findings = [];
  const conf = envelope?.confidence;

  if (conf) {
    if (typeof conf.score !== "number" || conf.score < 0 || conf.score > 1) {
      findings.push({ code: "C6-invalid-confidence-score", severity: "RED", detail: `confidence.score invalid: ${conf.score}` });
    }
    if (!conf.basis || typeof conf.basis !== "string") {
      findings.push({ code: "C6-missing-confidence-basis", severity: "RED", detail: "confidence.basis missing or not string" });
    }
    // sample_size may be null — that's OK
  }

  // Check narrative doesn't claim high confidence while structured is low (or vice versa)
  const narrativeText = (envelope?.narrative_sections || []).map(s => s.body || "").join(" ");
  const narrativeHighConf = /\b(confident|certain|clear|strong|definitely)\b/i.test(narrativeText);
  const structuredHighConf = conf && conf.score >= 0.7;

  if (narrativeHighConf !== structuredHighConf && conf) {
    findings.push({
      code: "C6-narrative-structured-mismatch",
      severity: "AMBER",
      detail: `Narrative confidence=${narrativeHighConf}, structured score=${conf.score}. Should align.`,
    });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C7 EVIDENCE
 * evidence: string[] — specific numbers, not restatements
 */
function auditC7Evidence(envelope) {
  const findings = [];
  const evidence = envelope?.evidence;

  if (!Array.isArray(evidence)) {
    findings.push({ code: "C7-missing-evidence", severity: "AMBER", detail: "envelope.evidence not an array" });
    return findings;
  }

  if (evidence.length === 0) {
    findings.push({ code: "C7-empty-evidence", severity: "AMBER", detail: "envelope.evidence is empty — no specific numbers" });
  }

  evidence.forEach((item, i) => {
    if (typeof item !== "string") {
      findings.push({ code: "C7-non-string-evidence", severity: "RED", detail: `evidence[${i}] is not a string` });
    } else if (!/\d/.test(item)) {
      findings.push({ code: "C7-evidence-no-numbers", severity: "AMBER", detail: `evidence[${i}] contains no numbers: "${item.slice(0, 50)}"` });
    }
  });

  return findings;
}

/**
 * CONTRACT AUDIT: C8 PROVENANCE
 * source: "polygon" | "unusual_whales" | "benzinga" | "internal_db" | "redis" | "computed"
 * cohort: required alongside rates/coverage/fill numbers
 */
function auditC8Provenance(envelope) {
  const findings = [];
  const source = envelope?.source;

  if (!source) {
    findings.push({ code: "C8-missing-source", severity: "AMBER", detail: "envelope.source missing" });
  } else if (!["polygon", "unusual_whales", "benzinga", "internal_db", "redis", "computed"].includes(source)) {
    findings.push({ code: "C8-invalid-source", severity: "RED", detail: `source invalid: ${source}` });
  }

  // Check if claims include rates/coverage/fill without cohort
  const narrativeText = (envelope?.narrative_sections || []).map(s => s.body || "").join(" ");
  const hasCoverage = /\b(\d+%|coverage|fill|rate)\b/i.test(narrativeText);
  const hasCohort = envelope?.cohort !== undefined && envelope.cohort !== null;

  if (hasCoverage && !hasCohort && envelope?.source === "internal_db") {
    findings.push({
      code: "C8-missing-cohort",
      severity: "AMBER",
      detail: "Narrative mentions coverage/rate but cohort is missing — required for rates to be interpretable",
    });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C9 PRECISION
 * No rounding inside providers — only at tool boundary
 */
function auditC9Precision(envelope) {
  // This would require deep inspection of how numbers are computed
  // For now, just check for obviously-rounded numbers in narrative
  const findings = [];
  const narrativeText = (envelope?.narrative_sections || []).map(s => s.body || "").join(" ");

  // Check for suspicious rounding (x.00%, x.0%, whole numbers where decimals expected)
  const roundedNumbers = narrativeText.match(/\b\d+\.00%|\b\d+\.0%\b/g) || [];
  if (roundedNumbers.length > 0) {
    findings.push({
      code: "C9-suspicious-rounding",
      severity: "AMBER",
      detail: `Narrative contains potentially-premature rounding: ${roundedNumbers.slice(0, 3).join(", ")}`,
    });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C10 HISTORICAL CONTEXT
 * If available, should be exposed as a tool, not baked into prose
 */
function auditC10HistoricalContext(envelope) {
  const findings = [];
  const narrativeText = (envelope?.narrative_sections || []).map(s => s.body || "").join(" ");

  // Check if narrative bakes historical reasoning without tool
  if (/\b(historically|past sessions|precedent|similar conditions)\b/i.test(narrativeText) && !envelope?.historical_tool) {
    findings.push({
      code: "C10-baked-historical-context",
      severity: "AMBER",
      detail: "Narrative mentions historical context but no historical_tool exposed — should be separate tool",
    });
  }

  return findings;
}

/**
 * Main audit runner
 */
async function auditPlayBriefs() {
  const session = await mintClerkPremiumSession();
  if (!session) {
    console.error("Failed to mint session");
    process.exit(1);
  }

  const results = {
    timestamp: new Date().toISOString(),
    tickers_audited: TICKERS,
    total_plays: 0,
    findings_by_code: {},
    plays_with_findings: [],
  };

  console.log(`Auditing ${TICKERS.length} tickers against LARGO-PRODUCT-CONTRACT.md...`);

  for (const ticker of TICKERS) {
    try {
      const url = `${BASE}/api/market/swing/play-brief?playId=SWING:${ticker}&ticker=${ticker}`;
      const res = await fetchRetry(url, {
        headers: { Cookie: session.cookieHeader },
      });

      if (res.status !== 200) {
        console.log(`${ticker}: HTTP ${res.status}`);
        continue;
      }

      const envelope = await res.json();
      if (!envelope) continue;

      results.total_plays += 1;
      const findings = [];

      // Run all contract audits
      findings.push(...auditC1Time(envelope));
      findings.push(...auditC2Freshness(envelope));
      findings.push(...auditC3Absence(envelope));
      findings.push(...auditC4Identity(envelope));
      findings.push(...auditC5Direction(envelope));
      findings.push(...auditC6Confidence(envelope));
      findings.push(...auditC7Evidence(envelope));
      findings.push(...auditC8Provenance(envelope));
      findings.push(...auditC9Precision(envelope));
      findings.push(...auditC10HistoricalContext(envelope));

      if (findings.length > 0) {
        results.plays_with_findings.push({ ticker, playId: envelope.playId, findings });
        findings.forEach(f => {
          results.findings_by_code[f.code] = (results.findings_by_code[f.code] || 0) + 1;
        });

        const redCount = findings.filter(f => f.severity === "RED").length;
        console.log(`${ticker}: ${findings.length} findings (${redCount} RED)`);
      } else {
        console.log(`${ticker}: PASS`);
      }
    } catch (err) {
      console.log(`${ticker}: ERROR ${err.message}`);
    }
  }

  // Cleanup
  try {
    await session.cleanup();
  } catch {
    // Ignore
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`\nSummary: ${results.total_plays} plays audited`);
    console.log(`Findings by code:`);
    Object.entries(results.findings_by_code)
      .sort((a, b) => b[1] - a[1])
      .forEach(([code, count]) => console.log(`  ${code}: ${count}`));

    if (results.plays_with_findings.length > 0) {
      console.log(`\nPlays with findings (first 5):`);
      results.plays_with_findings.slice(0, 5).forEach(({ ticker, findings }) => {
        console.log(`  ${ticker}: ${findings.map(f => f.code).join(", ")}`);
      });
    }
  }

  const redFindings = results.plays_with_findings.flatMap(p => p.findings).filter(f => f.severity === "RED");
  process.exit(redFindings.length > 0 ? 1 : 0);
}

auditPlayBriefs().catch(err => {
  console.error("Audit failed:", err);
  process.exit(2);
});
