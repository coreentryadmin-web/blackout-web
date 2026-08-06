/**
 * Shared Clerk temp-user creation for the audit harnesses.
 *
 * WHY THIS MODULE EXISTS (task #175 → the 2026-08-06 P3 regression)
 * -----------------------------------------------------------------
 * Every audit harness mints a throwaway admin+premium Clerk user, signs in through the
 * FAPI ticket exchange, does its read-only work, then deletes the user. Clerk enforces
 * uniqueness on BOTH identifiers it is handed — the e-mail AND the phone number — so the
 * create call can fail two structurally different ways:
 *
 *   1. E-MAIL collision. The harness's e-mail is a fixed constant (e.g.
 *      claude-audit-temp@blackouttrades.com), so a leftover user from a previous run owns
 *      it. Recovery = look the existing user up BY E-MAIL and adopt it (re-PATCH its
 *      metadata). Every harness already did this.
 *
 *   2. PHONE collision. The phone is drawn at random from +1415555{0000..9999}
 *      (lib/audit-phone.mjs), so a collision means some OTHER user — a concurrently-alive
 *      sibling harness, or a leaked temp user whose end-of-run DELETE didn't stick — holds
 *      that number. Recovery = simply DRAW A DIFFERENT NUMBER. Nothing about the run is
 *      actually broken.
 *
 * The bug: the copy-pasted recovery block in every harness only ever handled case (1). It
 * matched ANY create failure and then looked the user up by E-MAIL — so on a PHONE
 * collision the lookup returned nothing, userId stayed null, and the run died at auth with
 * no retry. Observed live 2026-08-06 17:33 UTC in data-validator.mjs:
 *
 *   [FAIL] auth: create/adopt temp user —
 *     {"errors":[{"message":"This phone number is already associated with an existing account..."}]}
 *   TOTALS {"FAIL":1}
 *
 * A bare re-run succeeded (different random draw). That matters because the standing
 * 13:32 UTC market-open validation trigger runs UNATTENDED: a recoverable identifier clash
 * was being reported as a hard RED on the whole validation gate.
 *
 * The collision is not exotic: 10,000 possible numbers against the ~30 temp users alive at
 * once on a busy audit day is a ~4.5% birthday-collision chance per run, and every leaked
 * temp user burns its number permanently.
 *
 * SO: one implementation of "create or adopt a temp audit user", used by every harness,
 * that distinguishes the two collision kinds and retries the recoverable one.
 */
import { generateDefaultAuditPhone } from "./audit-phone.mjs";

export const CLERK_API = "https://api.clerk.com/v1";

/** The metadata every audit harness stamps on its temp user (admin bypasses launch gates). */
export const DEFAULT_AUDIT_METADATA = Object.freeze({ role: "admin", tier: "premium" });

/** Clerk sometimes returns a bare error object rather than an array; normalize both. */
function errorList(errors) {
  if (Array.isArray(errors)) return errors;
  if (errors && typeof errors === "object") return [errors];
  return [];
}

/**
 * The offending field, per Clerk. The Backend API returns snake_case (`meta.param_name`);
 * a few SDK/edge-serialized shapes hand back camelCase (`meta.paramName`). Read both — the
 * structured param is the RELIABLE discriminator, and the human-readable `message` regexes
 * below are only a belt-and-braces fallback for payload shapes we haven't seen live.
 */
function paramOf(e) {
  return String(e?.meta?.param_name ?? e?.meta?.paramName ?? "");
}

function textOf(e) {
  return `${String(e?.message ?? "")} ${String(e?.long_message ?? "")}`.trim();
}

/** True when the create failed because the PHONE NUMBER is taken (retryable: redraw). */
export function isClerkPhoneCollision(errors) {
  return errorList(errors).some((e) => {
    const param = paramOf(e);
    const msg = textOf(e);
    if (param === "phone_number" || param === "phone_numbers") {
      return /identifier_exists|already|taken|duplicate/i.test(`${String(e?.code ?? "")} ${msg}`);
    }
    // Message fallback — the live 2026-08-06 payload carried ONLY a `message`, no meta.
    return /phone number is already associated/i.test(msg) || /phone_number.*(taken|exists)/i.test(msg);
  });
}

/** True when the create failed because the E-MAIL is taken (recoverable: adopt that user). */
export function isClerkEmailCollision(errors) {
  return errorList(errors).some((e) => {
    const param = paramOf(e);
    // A phone-param error is never an e-mail collision, even though both share the
    // `form_identifier_exists` code — that shared code is exactly what made the old
    // regex-on-the-whole-payload check mistake a phone clash for an e-mail one.
    if (param === "phone_number" || param === "phone_numbers") return false;
    const blob = `${String(e?.code ?? "")} ${textOf(e)}`;
    if (/phone number is already associated/i.test(blob)) return false;
    if (param === "email_address" || param === "email_addresses") {
      return /identifier_exists|already|taken|duplicate/i.test(blob);
    }
    return /form_identifier_exists/i.test(blob);
  });
}

/** Which failure we're looking at — used for the error message and by the unit tests. */
export function classifyClerkCreateFailure(errors) {
  if (isClerkPhoneCollision(errors)) return "phone_collision";
  if (isClerkEmailCollision(errors)) return "email_collision";
  return "other";
}

function summarizeErrors(errors) {
  const list = errorList(errors);
  if (list.length === 0) return "";
  // Clerk error payloads carry no secrets (they echo the offending identifier at most), but
  // keep them short so a harness log line stays readable.
  return JSON.stringify(list).slice(0, 240);
}

/**
 * Transport-agnostic "create or adopt a temp audit Clerk user", with bounded phone-collision
 * retries. Callbacks may be sync (the spawnSync-curl harnesses) or async (the fetch ones) —
 * both are awaited, so one implementation serves the whole fleet.
 *
 * @param {object}   o
 * @param {(phone: string) => any} o.createUser  POST /users with this phone → parsed JSON
 *                                               ({ id } on success, { errors } on failure).
 * @param {() => any} [o.adoptByEmail]  GET /users?email_address=… → the existing user, for the
 *                                      E-MAIL-collision path only. Omit to disable adoption
 *                                      (harnesses whose e-mail is already unique per run).
 * @param {(userId: string) => any} [o.onAdopt]  Called after adopting (re-PATCH metadata).
 * @param {string|null} [o.phone]  Phone for the FIRST attempt (the harness's per-run constant
 *                                 or an operator AUDIT_PHONE override). Retries always redraw.
 * @param {() => string} [o.newPhone]  Fresh-number source (injectable for tests).
 * @param {number} [o.maxPhoneAttempts]  Total create attempts before giving up.
 * @returns {Promise<{userId: string, phone: string|null, adopted: boolean, attempts: number}
 *                 | {error: string, errorKind: string, attempts: number}>}
 */
export async function createOrAdoptAuditUser({
  createUser,
  adoptByEmail = null,
  onAdopt = null,
  phone = null,
  newPhone = generateDefaultAuditPhone,
  maxPhoneAttempts = 5,
}) {
  let attempts = 0;
  let lastErrors = null;

  for (let attempt = 0; attempt < Math.max(1, maxPhoneAttempts); attempt++) {
    // Attempt 0 honors the caller's number (its per-run constant, or an operator-pinned
    // AUDIT_PHONE). Every RETRY deliberately ignores it and redraws: re-POSTing the SAME
    // number that Clerk just rejected as taken can only fail again, so an AUDIT_PHONE
    // override must not be able to pin the loop into burning all its attempts on one value.
    const candidate = attempt === 0 && phone ? phone : newPhone();
    attempts++;

    const created = await createUser(candidate);
    if (created?.id) return { userId: created.id, phone: candidate, adopted: false, attempts };

    const errors = created?.errors ?? null;
    if (errors) lastErrors = errors;

    // E-MAIL collision → adopt the existing user. Checked BEFORE the phone retry because a
    // create can trip both at once (leftover user owns the fixed e-mail AND a phone clash):
    // adopting resolves it outright, and the adopted user keeps whatever phone it already
    // has, so the number we failed on stops mattering.
    if (isClerkEmailCollision(errors) && adoptByEmail) {
      const existing = await adoptByEmail();
      if (existing?.id) {
        if (onAdopt) await onAdopt(existing.id);
        return { userId: existing.id, phone: null, adopted: true, attempts };
      }
    }

    // PHONE collision → recoverable, redraw on the next pass. Anything else (bad key,
    // instance misconfig, rate limit) will not fix itself by retrying, so fail fast.
    if (isClerkPhoneCollision(errors)) continue;
    break;
  }

  const kind = classifyClerkCreateFailure(lastErrors);
  const detail = summarizeErrors(lastErrors);
  const error =
    kind === "phone_collision"
      ? `phone-number collision persisted across ${attempts} attempt(s) with distinct +1415555XXXX numbers — likely leaked temp users holding numbers; ${detail}`
      : detail || "Clerk user create failed (no error payload)";
  return { error, errorKind: kind, attempts };
}

/**
 * Adapter for the spawnSync-`curl` harness family (data-validator, the E2E healthchecks,
 * the replay/probe tools …). They all share the same primitive:
 *   curl({ method, url, headers, json }) -> { s, b }
 * so handing that function in is enough — no harness needs its own create/adopt/retry copy.
 */
export async function createOrAdoptAuditUserViaCurl({
  curl,
  api = CLERK_API,
  secret,
  email,
  phone = null,
  publicMetadata = DEFAULT_AUDIT_METADATA,
  maxPhoneAttempts = 5,
  adopt = true,
  extraBody = null,
}) {
  // Two curl-helper shapes exist in this repo: most return { s, b }, the
  // comprehensive/exhaustive audits return { status, timeMs, body }. Read either body key so
  // neither family needs a shim.
  const parse = (r) => {
    try {
      return JSON.parse(r?.b ?? r?.body ?? "");
    } catch {
      return null;
    }
  };
  const backend = (method, path, json) =>
    curl({ method, url: `${api}${path}`, headers: { Authorization: `Bearer ${secret}` }, json });

  return createOrAdoptAuditUser({
    phone,
    maxPhoneAttempts,
    createUser: (p) =>
      parse(
        backend("POST", "/users", {
          email_address: [email],
          phone_number: [p],
          public_metadata: publicMetadata,
          skip_password_requirement: true,
          skip_legal_checks: true,
          ...(extraBody || {}),
        })
      ),
    adoptByEmail: adopt
      ? () =>
          (parse(
            curl({
              method: "GET",
              url: `${api}/users?email_address=${encodeURIComponent(email)}`,
              headers: { Authorization: `Bearer ${secret}` },
            })
          ) || [])[0]
      : null,
    onAdopt: adopt ? (id) => backend("PATCH", `/users/${id}`, { public_metadata: publicMetadata }) : null,
  });
}

/**
 * Adapter for the `fetch`-based harnesses. Same semantics as the curl adapter.
 * @returns {{ userId: string } | { error: string }}
 */
export async function createAuditClerkUser({
  secret,
  email,
  publicMetadata = DEFAULT_AUDIT_METADATA,
  phone = process.env.AUDIT_PHONE || null,
  maxPhoneAttempts = 5,
  adopt = true,
  extraBody = null,
}) {
  const backend = async (method, path, body) => {
    const r = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json().catch(() => null);
  };

  const res = await createOrAdoptAuditUser({
    phone,
    maxPhoneAttempts,
    createUser: (p) =>
      backend("POST", "/users", {
        email_address: [email],
        phone_number: [p],
        public_metadata: publicMetadata,
        skip_password_requirement: true,
        skip_legal_checks: true,
        ...(extraBody || {}),
      }),
    adoptByEmail: adopt
      ? async () => {
          const r = await fetch(`${CLERK_API}/users?email_address=${encodeURIComponent(email)}`, {
            headers: { Authorization: `Bearer ${secret}` },
          });
          const list = await r.json().catch(() => null);
          return Array.isArray(list) ? list[0] : list?.data?.[0];
        }
      : null,
    onAdopt: adopt ? (id) => backend("PATCH", `/users/${id}`, { public_metadata: publicMetadata }) : null,
  });

  return res.error ? { error: res.error } : { userId: res.userId };
}

export async function deleteAuditClerkUser(secret, userId) {
  if (!secret || !userId) return;
  try {
    await fetch(`${CLERK_API}/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch {
    /* best-effort */
  }
}
