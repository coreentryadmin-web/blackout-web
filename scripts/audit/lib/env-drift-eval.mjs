/**
 * Pure comparison helpers for the production env-drift audit.
 *
 * WHY THIS EXISTS. A behaviour question answered from `config.ts` alone can be flatly wrong,
 * because the deployed value is what runs and nothing in the repo records which keys are set.
 * Measured on the SPX lane 2026-08-22: `SPX_DESK_CACHE_SEC` is 30 in production against a code
 * default of 20, so a freshness claim read off the source was wrong by 50% on the slowest lane;
 * and `PLAYBOOK_LIVE_GATE` is "1" against a default of `false`, which was the difference between
 * a latent landmine and a live P1 (two playbooks unable to produce an entry).
 *
 * Kept pure and dependency-free so it is unit-testable without AWS.
 */

/** Keys whose VALUES must never be printed, matched by name. Substring, case-insensitive. */
const SECRET_NAME_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|URL|WEBHOOK|DSN|CREDENTIAL|PASS/i;

export function isSecretish(name) {
  return SECRET_NAME_PATTERN.test(name);
}

/** Redact by NAME, never by value inspection — a short secret must not slip through on length. */
export function displayValue(name, value) {
  if (isSecretish(name)) return "<redacted: secret-shaped name>";
  return JSON.stringify(value);
}

/**
 * Compare one key's deployed value against its code default.
 *
 * `codeDefault` is what the source falls back to when the env var is absent, as a STRING (or null
 * when the audit could not determine it — which is reported as `unknown`, never guessed).
 *
 * Verdicts:
 *   `unset`      — not in the deployed env; the code default governs. The common, safe case.
 *   `no-op`      — set, but to a value equivalent to the default. Harmless, still worth listing:
 *                  it looks like a deliberate override and is not one, so a reader can waste time
 *                  reasoning about why it was changed.
 *   `override`   — set to something the code would not have chosen. THIS is the decoy case.
 *   `unknown`    — set, but the audit has no code default to compare against.
 */
export function classifyKey({ name, deployed, codeDefault }) {
  if (deployed === undefined || deployed === null) {
    return { name, verdict: "unset", deployed: null, codeDefault };
  }
  if (codeDefault == null) {
    return { name, verdict: "unknown", deployed, codeDefault: null };
  }
  return {
    name,
    verdict: equivalent(String(deployed), String(codeDefault)) ? "no-op" : "override",
    deployed,
    codeDefault,
  };
}

/**
 * Value equivalence, not string equality — `"0"` and `false` mean the same thing to a flag reader,
 * and `"30"` and `30` to a numeric one. Reporting those as overrides would bury the real ones in
 * noise, which is how a drift report stops being read.
 */
export function equivalent(a, b) {
  if (a === b) return true;
  const truthy = new Set(["1", "true", "yes", "on"]);
  const falsy = new Set(["0", "false", "no", "off", ""]);
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (truthy.has(la) && truthy.has(lb)) return true;
  if (falsy.has(la) && falsy.has(lb)) return true;
  const na = Number(la.replace(/_/g, ""));
  const nb = Number(lb.replace(/_/g, ""));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return false;
}

/** Roll a classified set up into the counts a reader acts on. */
export function summarize(rows) {
  const by = (v) => rows.filter((r) => r.verdict === v);
  return {
    total: rows.length,
    unset: by("unset").length,
    no_op: by("no-op").length,
    override: by("override").length,
    unknown: by("unknown").length,
    overrides: by("override"),
    no_ops: by("no-op"),
    unknowns: by("unknown"),
  };
}
