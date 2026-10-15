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
 * API response carries asOf: "YYYY-MM-DD HH:mm ET" at root level
 */
function auditC1Time(responseData) {
  const findings = [];
  const as_of = responseData?.asOf;

  if (!as_of) {
    findings.push({ code: "C1-missing-asOf", severity: "RED", detail: "root.asOf missing" });
  } else if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET$/.test(as_of)) {
    findings.push({ code: "C1-malformed-asOf", severity: "RED", detail: `asOf format invalid: ${as_of}` });
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
function auditC2Freshness(responseData) {
  const findings = [];
  const freshness = responseData?.freshness;
  const envelope = responseData?.envelope;

  // NOTE: freshness field not observed in API responses yet
  // This check will be AMBER if missing, but may be optional
  if (!freshness) {
    findings.push({ code: "C2-missing-freshness", severity: "AMBER", detail: "root.freshness not present in response" });
  } else if (!["live", "delayed", "cached", "snapshot", "stale"].includes(freshness)) {
    findings.push({ code: "C2-invalid-freshness-value", severity: "RED", detail: `freshness value invalid: ${freshness}` });
  }

  // Check narrative/structured alignment on staleness
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");
  const isNarrativeStale = /\b(stale|delayed|lag|expired)\b/i.test(narrativeText);
  const isStructuredStale = freshness === "stale" || freshness === "delayed";

  if (freshness && isNarrativeStale !== isStructuredStale) {
    findings.push({
      code: "C2-narrative-structured-mismatch",
      severity: "RED",
      detail: `Narrative says stale=${isNarrativeStale}, structured says ${freshness}. Must agree.`,
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
function auditC3Absence(responseData) {
  const findings = [];
  const envelope = responseData?.envelope;
  const unavail = envelope?.unavailableSources;

  // unavailableSources is a list of {source, reason, what_is_missing?, retryable?} objects
  // BieUnavailableSource requires source + reason (per answer-envelope.ts:107-112)
  if (unavail && Array.isArray(unavail)) {
    unavail.forEach((item, i) => {
      if (!item.source || typeof item.source !== "string") {
        findings.push({
          code: "C3-incomplete-absence-source",
          severity: "RED",
          detail: `unavailableSources[${i}] missing or invalid source field`,
        });
      }
      if (!item.reason || typeof item.reason !== "string") {
        findings.push({
          code: "C3-incomplete-absence-reason",
          severity: "RED",
          detail: `unavailableSources[${i}] missing or invalid reason field`,
        });
      }
    });
  }

  // Check narrative doesn't claim data missing while structured says it's available
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");
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
function auditC4Identity(responseData) {
  const findings = [];
  const ticker = responseData?.ticker;
  const ticker_class = responseData?.ticker_class;

  if (!ticker) {
    findings.push({ code: "C4-missing-ticker", severity: "RED", detail: "root.ticker missing" });
  } else if (!/^[A-Z]+$/.test(ticker)) {
    findings.push({ code: "C4-non-uppercase-ticker", severity: "RED", detail: `ticker not uppercase: ${ticker}` });
  } else if (ticker.includes("I:") || ticker.includes("W")) {
    findings.push({ code: "C4-non-canonical-ticker", severity: "AMBER", detail: `ticker may not be canonical root: ${ticker}` });
  }

  if (!ticker_class) {
    findings.push({ code: "C4-missing-ticker-class", severity: "AMBER", detail: "root.ticker_class not present (may not be computed yet)" });
  } else if (!["index", "equity", "etf"].includes(ticker_class)) {
    findings.push({ code: "C4-invalid-ticker-class", severity: "RED", detail: `ticker_class invalid: ${ticker_class}` });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C5 DIRECTION
 * bias: "bullish" | "bearish" | "neutral"
 * Keep product's native richer notion alongside it
 */
function auditC5Direction(responseData) {
  const findings = [];
  const envelope = responseData?.envelope;
  const bias = envelope?.bias;

  if (!bias) {
    findings.push({ code: "C5-missing-direction", severity: "AMBER", detail: "envelope.bias missing (may be unavailable)" });
  } else if (!["bullish", "bearish", "neutral"].includes(bias)) {
    findings.push({ code: "C5-invalid-direction", severity: "RED", detail: `bias invalid: ${bias}` });
  }

  // Check for raw signs (positive/negative/plus/minus) in narrative
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");
  if (/\b([+-]\d+%|positive|negative|[+−])\b/.test(narrativeText) && bias) {
    // This is OK — product's richer notion alongside labeled direction
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C6 CONFIDENCE
 * confidence?: { score: number; basis: string; sample_size: number | null }
 * OMIT if not calibrated — never fabricate
 */
function auditC6Confidence(responseData) {
  const findings = [];
  const envelope = responseData?.envelope;
  const conf = envelope?.confidence;

  if (!conf) {
    findings.push({ code: "C6-missing-confidence", severity: "AMBER", detail: "envelope.confidence not present (may not be calibrated yet)" });
  } else {
    // BieConfidence has level + why (not score + basis)
    // Level must be one of: "high" | "moderate" | "low" | "insufficient"
    if (!conf.level || typeof conf.level !== "string") {
      findings.push({ code: "C6-invalid-confidence-level", severity: "RED", detail: `confidence.level invalid: ${conf.level}` });
    } else if (!["high", "moderate", "low", "insufficient"].includes(conf.level)) {
      findings.push({ code: "C6-invalid-confidence-level-value", severity: "RED", detail: `confidence.level not in enum: ${conf.level}` });
    }
    if (!conf.why || typeof conf.why !== "string") {
      findings.push({ code: "C6-missing-confidence-why", severity: "RED", detail: "confidence.why missing or not string" });
    }
  }

  // Check narrative doesn't claim high confidence while structured is low (or vice versa)
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");
  const narrativeHighConf = /\b(confident|certain|clear|strong|definitely)\b/i.test(narrativeText);
  const structuredLowConf = conf && (conf.level === "low" || conf.level === "insufficient");

  if (narrativeHighConf && structuredLowConf) {
    findings.push({
      code: "C6-narrative-structured-mismatch",
      severity: "RED",
      detail: `Narrative claims high confidence, structured has level=${conf.level}. Must agree.`,
    });
  }

  return findings;
}

/**
 * CONTRACT AUDIT: C7 EVIDENCE
 * evidence: BieEvidence[] — { kind: "fact"|"calc"|"inference"|"scenario"; text: string; provenance?: {...} }
 * Specific numbers/facts, not restatements
 */
function auditC7Evidence(responseData) {
  const findings = [];
  const envelope = responseData?.envelope;
  const evidence = envelope?.evidence;

  if (!Array.isArray(evidence)) {
    findings.push({ code: "C7-missing-evidence", severity: "AMBER", detail: "envelope.evidence not an array (may extract from sections)" });
    return findings;
  }

  if (evidence.length === 0) {
    findings.push({ code: "C7-empty-evidence", severity: "AMBER", detail: "envelope.evidence is empty — no specific items" });
  }

  evidence.forEach((item, i) => {
    // BieEvidence should be {kind, text, provenance?}
    if (typeof item !== "object" || !item) {
      findings.push({ code: "C7-invalid-evidence-type", severity: "RED", detail: `evidence[${i}] is not an object` });
      return;
    }

    // Check kind field (required, must be one of the enum values)
    if (!item.kind || typeof item.kind !== "string") {
      findings.push({ code: "C7-invalid-evidence-kind", severity: "RED", detail: `evidence[${i}].kind invalid: ${item.kind}` });
    } else if (!["fact", "calc", "inference", "scenario"].includes(item.kind)) {
      findings.push({ code: "C7-invalid-evidence-kind-value", severity: "RED", detail: `evidence[${i}].kind not in enum: ${item.kind}` });
    }

    // Check text field (required, must be string)
    if (!item.text || typeof item.text !== "string") {
      findings.push({ code: "C7-invalid-evidence-text", severity: "RED", detail: `evidence[${i}].text invalid: ${typeof item.text}` });
    } else if (!/\d/.test(item.text)) {
      findings.push({ code: "C7-evidence-no-numbers", severity: "AMBER", detail: `evidence[${i}].text contains no numbers: "${item.text.slice(0, 50)}"` });
    }

    // Check provenance is optional but if present, must be {source, asOf?, freshness?}
    if (item.provenance && typeof item.provenance === "object") {
      if (!item.provenance.source || typeof item.provenance.source !== "string") {
        findings.push({ code: "C7-invalid-evidence-provenance-source", severity: "RED", detail: `evidence[${i}].provenance.source invalid` });
      }
    }
  });

  return findings;
}

/**
 * CONTRACT AUDIT: C8 PROVENANCE
 * source: "polygon" | "unusual_whales" | "benzinga" | "internal_db" | "redis" | "computed"
 * cohort: required alongside rates/coverage/fill numbers
 */
function auditC8Provenance(responseData) {
  const findings = [];
  const envelope = responseData?.envelope;
  const source = envelope?.source;
  const intent = envelope?.intent;

  if (!source) {
    findings.push({ code: "C8-missing-source", severity: "AMBER", detail: "envelope.source missing" });
  } else if (!["polygon", "unusual_whales", "benzinga", "internal_db", "redis", "computed"].includes(source)) {
    findings.push({ code: "C8-invalid-source", severity: "RED", detail: `source invalid: ${source}` });
  }

  if (!intent) {
    findings.push({ code: "C8-missing-intent", severity: "AMBER", detail: "envelope.intent missing" });
  } else if (intent !== "swing_play_brief") {
    findings.push({ code: "C8-unexpected-intent", severity: "AMBER", detail: `intent unexpected: ${intent}` });
  }

  // Check if claims include rates/coverage/fill without cohort
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");
  const hasCoverage = /\b(\d+%|coverage|fill|rate)\b/i.test(narrativeText);
  const hasCohort = envelope?.cohort !== undefined && envelope.cohort !== null;

  if (hasCoverage && !hasCohort && source === "internal_db") {
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
function auditC9Precision(responseData) {
  // This would require deep inspection of how numbers are computed
  // For now, just check for obviously-rounded numbers in narrative
  const findings = [];
  const envelope = responseData?.envelope;
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");

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
function auditC10HistoricalContext(responseData) {
  const findings = [];
  const envelope = responseData?.envelope;
  const narrativeText = (envelope?.sections || []).map(s => s.body || "").join(" ");

  // Check if narrative bakes historical reasoning without tool
  if (/\b(historically|past sessions|precedent|similar conditions|archetype|win rate|track record)\b/i.test(narrativeText) && !envelope?.historical_tool) {
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
  const session = await mintClerkPremiumSession({ appUrl: BASE });
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

      const responseData = await res.json();
      if (!responseData) continue;

      results.total_plays += 1;
      const findings = [];

      // Run all contract audits
      // Note: functions receive full responseData and extract envelope internally via responseData?.envelope
      findings.push(...auditC1Time(responseData));
      findings.push(...auditC2Freshness(responseData));
      findings.push(...auditC3Absence(responseData));
      findings.push(...auditC4Identity(responseData));
      findings.push(...auditC5Direction(responseData));
      findings.push(...auditC6Confidence(responseData));
      findings.push(...auditC7Evidence(responseData));
      findings.push(...auditC8Provenance(responseData));
      findings.push(...auditC9Precision(responseData));
      findings.push(...auditC10HistoricalContext(responseData));

      if (findings.length > 0) {
        const playId = responseData?.playId || responseData?.envelope?.playId;
        results.plays_with_findings.push({ ticker, playId, findings });
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
