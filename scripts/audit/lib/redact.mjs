/**
 * Secret-safe error text for child-process failures.
 *
 * WHY THIS EXISTS. 22 audit harnesses carry the header claim "Never prints secrets." Nothing
 * enforced it — the property was held by construction, and the construction had a hole.
 *
 * Every `curl`-based harness in this repo builds its request as an argv array:
 *
 *     args.push('-H', `Authorization: Bearer ${SECRET}`)          // CLERK_SECRET_KEY
 *     args.push('--data-urlencode', `ticket=${ticket}`)           // one-shot sign-in credential
 *
 * and then does `execFileSync('curl', args)`. When curl exits non-zero Node throws an Error whose
 * message BEGINS with the entire command line:
 *
 *     Command failed: curl -sS ... -H Authorization: Bearer sk_live_... https://api.clerk.com/v1/...
 *
 * The harnesses captured exactly that line — `String(e.message || e).split('\n')[0]` — into a
 * returned `.err`. Verified under Node 20.20.2: the resulting string contains the full secret.
 *
 * The sibling `aws()` helper in the same files already gets this right: it prefers `e.stderr` and
 * takes the LAST line, which skips the argv entirely. This module makes that the shared, tested
 * behaviour rather than a habit two files happened to have.
 *
 * TWO LAYERS, deliberately:
 *   1. `subprocessErrorMessage()` never returns the `Command failed:` argv line in the first place.
 *   2. `redactSecrets()` scrubs what does come back, so a diagnostic that echoes a secret from some
 *      other direction (a server error quoting the header, a future caller) still cannot print it.
 *
 * Layer 2 alone would be a filter over a leak; layer 1 alone would fail the moment a caller reaches
 * for `e.message` directly. Neither is sufficient, which is why both are here.
 */

/** Env var names whose VALUES must never appear in output. Substring match, case-insensitive. */
const SECRET_NAME_HINTS = ["SECRET", "TOKEN", "PASSWORD", "PASSWD", "CREDENTIAL", "PRIVATE_KEY", "API_KEY", "APIKEY"];

/** Values shorter than this are too collision-prone to blanket-replace (e.g. KEY="1"). */
const MIN_REDACTABLE_LENGTH = 8;

export const REDACTED = "[REDACTED]";

/** Literal-safe regex escape. */
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Secret-shaped patterns, redacted by SHAPE so a value that never reached this process's env
 * (a ticket minted at runtime, a key read from AWS) is still caught.
 */
const PATTERNS = [
  // Clerk backend secret keys, and any provider using the sk_/rk_ convention.
  [/\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, `$1_$2_${REDACTED}`],
  // Authorization headers of every scheme.
  [/\b(Authorization:\s*(?:Bearer|Basic|Token)\s+)\S+/gi, `$1${REDACTED}`],
  // Clerk sign-in tickets / session JWTs passed as form fields or query params.
  [/\b(ticket|token|session|jwt|api_key|apikey|access_token|refresh_token)=([^\s&"']{8,})/gi, `$1=${REDACTED}`],
  // AWS access key ids (the secret access key is caught by the env-value pass).
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  // Bare JWTs anywhere in the string.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, REDACTED],
];

/**
 * Remove secrets from arbitrary text.
 *
 * @param {unknown} text
 * @param {Record<string,string|undefined>} [env] injectable for tests
 * @returns {string}
 */
export function redactSecrets(text, env = process.env) {
  let out = String(text ?? "");
  if (!out) return out;

  // Pass 1 — exact values from the environment. Strongest signal available: if it is in env under
  // a secret-shaped name and it is in the string, it is the secret, whatever shape it has.
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    if (v.length < MIN_REDACTABLE_LENGTH) continue;
    if (!SECRET_NAME_HINTS.some((h) => name.toUpperCase().includes(h))) continue;
    if (!out.includes(v)) continue;
    out = out.split(v).join(REDACTED);
  }

  // Pass 2 — shape-based, for secrets this process never held in env.
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);

  return out;
}

/**
 * The safe replacement for `String(e.message || e).split("\n")[0]` on a child-process failure.
 *
 * Prefers the child's own stderr — the actual diagnostic — and never returns Node's
 * `Command failed: <argv>` line, which is the line that carries the credentials.
 *
 * @param {unknown} e error thrown by execFileSync/spawnSync/exec
 * @param {Record<string,string|undefined>} [env] injectable for tests
 * @returns {string}
 */
export function subprocessErrorMessage(e, env = process.env) {
  const stderr = typeof e?.stderr === "string" ? e.stderr : e?.stderr?.toString?.() ?? "";
  const fromStderr = stderr.split("\n").map((l) => l.trim()).filter(Boolean).slice(-1)[0];
  if (fromStderr) return redactSecrets(fromStderr, env);

  // No stderr — fall back to the message with the argv line dropped rather than kept.
  const msg = String(e?.message ?? e ?? "");
  const lines = msg.split("\n").map((l) => l.trim()).filter(Boolean);
  const nonArgv = lines.filter((l) => !/^Command failed:/i.test(l));
  const picked = nonArgv[0] ?? (lines[0] ? `${String(lines[0]).split(":")[0]}: command failed` : "command failed");
  return redactSecrets(picked, env);
}
