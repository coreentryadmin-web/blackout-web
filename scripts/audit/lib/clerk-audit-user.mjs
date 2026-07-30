/**
 * Shared Clerk temp-user creation for audit harnesses.
 *
 * Handles email collision (adopt existing user by email) and phone collision
 * (retry with a fresh generateDefaultAuditPhone suffix — task #175 class).
 */
import { generateDefaultAuditPhone } from "./audit-phone.mjs";

const API = "https://api.clerk.com/v1";

export function isClerkPhoneCollision(errors) {
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const msg = String(e?.message ?? e?.long_message ?? "");
    const param = String(e?.meta?.param_name ?? "");
    return (
      /phone number is already associated/i.test(msg) ||
      /phone_number.*taken/i.test(msg) ||
      (param === "phone_number" && /identifier_exists|already/i.test(String(e?.code ?? msg)))
    );
  });
}

export function isClerkEmailCollision(errors) {
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const param = String(e?.meta?.param_name ?? "");
    if (param === "phone_number") return false;
    return /form_identifier_exists/i.test(String(e?.code ?? "")) || /form_identifier_exists/i.test(String(e?.message ?? ""));
  });
}

/**
 * Create or adopt a temp audit Clerk user. Retries on phone collision.
 * @returns {{ userId: string } | { error: string }}
 */
export async function createAuditClerkUser({
  secret,
  email,
  publicMetadata = { role: "admin", tier: "premium" },
  maxPhoneAttempts = 6,
}) {
  const backend = (method, path, body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  for (let attempt = 0; attempt < maxPhoneAttempts; attempt++) {
    const phone = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
    const createRes = await backend("POST", "/users", {
      email_address: [email],
      phone_number: [phone],
      public_metadata: publicMetadata,
      skip_password_requirement: true,
      skip_legal_checks: true,
    });
    const created = await createRes.json().catch(() => null);
    if (created?.id) {
      return { userId: created.id };
    }

    const errors = created?.errors;
    if (isClerkEmailCollision(errors) && !isClerkPhoneCollision(errors)) {
      const lookup = await fetch(`${API}/users?email_address=${encodeURIComponent(email)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const existing = (await lookup.json().catch(() => []))?.[0];
      if (existing?.id) {
        await backend("PATCH", `/users/${existing.id}`, { public_metadata: publicMetadata });
        return { userId: existing.id };
      }
    }

    if (isClerkPhoneCollision(errors) && attempt < maxPhoneAttempts - 1) {
      continue;
    }

    return { error: JSON.stringify(errors ?? "").slice(0, 240) || "Clerk user create failed" };
  }

  return { error: "Clerk user create failed after phone retries" };
}

export async function deleteAuditClerkUser(secret, userId) {
  if (!secret || !userId) return;
  try {
    await fetch(`${API}/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch {
    /* best-effort */
  }
}
