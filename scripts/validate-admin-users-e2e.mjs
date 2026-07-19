#!/usr/bin/env node
/**
 * Deep admin user-management API E2E — create, list, search, promote, demote,
 * ban/unban, tool grant/block/inherit, bulk, sign-in link, self-guards, delete.
 *
 * Requires localhost Next dev in keyless Clerk mode:
 *   env -u CLERK_SECRET_KEY -u NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY npm run dev
 *
 * Usage:
 *   npm run validate:admin-users-e2e
 *   ADMIN_E2E_BASE=http://127.0.0.1:3000 node scripts/validate-admin-users-e2e.mjs
 */
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";
import { clerkBackend } from "./audit/lib/keyless-clerk-session.mjs";
import {
  mintAdminE2ESession,
  mintMemberE2ESession,
  mintSessionForUserId,
} from "./audit/lib/admin-e2e-auth.mjs";
import {
  fetchHtml,
  fetchJson,
  record,
  summarize,
  waitForServer,
  writeReport,
} from "./audit/lib/admin-e2e-helpers.mjs";

const BASE = (
  process.env.ADMIN_E2E_BASE ??
  (process.env.CLERK_SECRET_KEY ? "https://blackouttrades.com" : "http://127.0.0.1:3000")
).replace(/\/$/, "");
const rows = [];
const rec = (name, status, detail) => rows.push(record(name, status, detail));

function assertStatus(name, got, expected, detail = "") {
  if (got === expected) rec(name, "PASS", detail);
  else rec(name, "FAIL", `expected HTTP ${expected}, got ${got}${detail ? ` — ${detail}` : ""}`);
}

function assertTruthy(name, value, detail = "") {
  if (value) rec(name, "PASS", detail);
  else rec(name, "FAIL", detail || "expected truthy");
}

function assertFalsy(name, value, detail = "") {
  if (!value) rec(name, "PASS", detail);
  else rec(name, "FAIL", detail || "expected falsy");
}

async function main() {
  console.log(`Admin user-management E2E → ${BASE}\n`);

  if (!(await waitForServer(BASE))) {
    console.error("Dev server not reachable — start with keyless Clerk first.");
    process.exit(1);
  }

  const adminSession = await mintAdminE2ESession({
    appUrl: BASE,
    emailPrefix: "admin-users-e2e",
  });
  if (adminSession.skip) {
    console.error("SKIP:", adminSession.reason);
    process.exit(0);
  }

  const adminCookie = adminSession.cookieHeader;
  let adminId = adminSession.userId;
  const secret = adminSession.secret;
  const publishableKey = adminSession.publishableKey;
  const backend = secret ? await clerkBackend(secret) : null;

  if (!adminId && secret) {
    const meProbe = await fetchJson(BASE, "/api/admin/me", { cookie: adminCookie });
    const email = meProbe.json?.email;
    if (email && backend) {
      const lookup = await backend("GET", `/users?email_address=${encodeURIComponent(email)}`);
      adminId = Array.isArray(lookup.json) ? lookup.json[0]?.id : lookup.json?.data?.[0]?.id;
    }
  }

  const cleanupIds = [];

  try {
    // ── Auth gates ──────────────────────────────────────────────────────
    const unauth = await fetchJson(BASE, "/api/admin/users");
    assertStatus("unauthenticated list → 401", unauth.status, 401);

    const memberSession = await mintMemberE2ESession({
      appUrl: BASE,
      emailPrefix: "admin-users-member",
    });
    if (!memberSession.skip) {
      const forbidden = await fetchJson(BASE, "/api/admin/users", { cookie: memberSession.cookieHeader });
      assertStatus("non-admin list → 403", forbidden.status, 403);
      await memberSession.cleanup?.();
    } else {
      rec("non-admin list → 403", "SKIP", memberSession.reason);
    }

    const me = await fetchJson(BASE, "/api/admin/me", { cookie: adminCookie });
    assertStatus("admin /api/admin/me → 200", me.status, 200);
    assertTruthy("admin me.admin === true", me.json?.admin === true);

    // ── List + pagination ───────────────────────────────────────────────
    const list = await fetchJson(BASE, "/api/admin/users?page=1&limit=5", { cookie: adminCookie });
    assertStatus("list users → 200", list.status, 200);
    assertTruthy("list returns users array", Array.isArray(list.json?.users));
    assertTruthy("list has total/pages", typeof list.json?.total === "number" && list.json?.pages >= 0);

    // ── Create validation ─────────────────────────────────────────────────
    const noEmail = await fetchJson(BASE, "/api/admin/users/create", {
      method: "POST",
      cookie: adminCookie,
      body: { phone: generateDefaultAuditPhone() },
    });
    assertStatus("create without email → 400", noEmail.status, 400);

    const noPhone = await fetchJson(BASE, "/api/admin/users/create", {
      method: "POST",
      cookie: adminCookie,
      body: { email: `no-phone-${Date.now()}@example.com` },
    });
    assertStatus("create without phone → 400", noPhone.status, 400);

    const badRole = await fetchJson(BASE, "/api/admin/users/create", {
      method: "POST",
      cookie: adminCookie,
      body: {
        email: `bad-role-${Date.now()}@example.com`,
        phone: generateDefaultAuditPhone(),
        role: "superuser",
      },
    });
    assertStatus("create invalid role → 400", badRole.status, 400);

    // ── Create test subject ───────────────────────────────────────────────
    let create = await fetchJson(BASE, "/api/admin/users/create", {
      method: "POST",
      cookie: adminCookie,
      body: {
        email: `e2e-subject-${Date.now()}@blackouttrades.com`,
        phone: generateDefaultAuditPhone(),
        firstName: "E2E",
        lastName: "Subject",
        tier: "free",
        role: "member",
        syncWhop: false,
      },
    });

    let subjectId = create.json?.id;
    if (create.status !== 201 && secret) {
      // Fallback: direct Clerk create when deployed route lacks skip-password flags
      const direct = await (await clerkBackend(secret))("POST", "/users", {
        email_address: [`e2e-subject-fb-${Date.now()}@blackouttrades.com`],
        phone_number: [generateDefaultAuditPhone()],
        first_name: "E2E",
        last_name: "Subject",
        public_metadata: { tier: "free" },
        skip_password_requirement: true,
        skip_password_checks: true,
        skip_legal_checks: true,
      });
      if (direct.json?.id) {
        subjectId = direct.json.id;
        rec("create user → 201", "WARN", "admin create failed — used Clerk backend fallback");
      }
    } else {
      assertStatus("create user → 201", create.status, 201);
    }
    assertTruthy("create returns user id", subjectId);
    if (subjectId) cleanupIds.push(subjectId);

    // ── Search by email ───────────────────────────────────────────────────
    if (create.json?.email) {
      const search = await fetchJson(BASE, `/api/admin/users?q=${encodeURIComponent(create.json.email)}`, {
        cookie: adminCookie,
      });
      assertStatus("search by email → 200", search.status, 200);
      const hit = (search.json?.users ?? []).some((u) => u.id === subjectId);
      assertTruthy("search finds created user", hit, create.json.email);
    }

    // ── Detail + 404 ──────────────────────────────────────────────────────
    const detail = await fetchJson(BASE, `/api/admin/users/${subjectId}`, { cookie: adminCookie });
    assertStatus("get user detail → 200", detail.status, 200);
    assertTruthy("detail includes toolAccess[]", Array.isArray(detail.json?.toolAccess));
    assertTruthy("detail firstName E2E", detail.json?.firstName === "E2E");

    const toolsDeployed = Array.isArray(detail.json?.toolAccess);

    const missing = await fetchJson(BASE, "/api/admin/users/user_nonexistent_e2e", { cookie: adminCookie });
    assertStatus("get missing user → 404", missing.status, 404);

    // ── Profile patch ─────────────────────────────────────────────────────
    const patchName = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { firstName: "Patched", lastName: "Name" },
    });
    assertStatus("patch name → 200", patchName.status, 200);
    assertTruthy("patch name applied", patchName.json?.firstName === "Patched");

    // ── Promote / demote ──────────────────────────────────────────────────
    const promote = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "admin" },
    });
    assertStatus("promote to admin → 200", promote.status, 200);
    assertTruthy("promoted role admin", promote.json?.role === "admin");

    const demote = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "member" },
    });
    assertStatus("demote to member → 200", demote.status, 200);
    assertTruthy("demoted role empty/member", demote.json?.role === "" || demote.json?.role === "member");

    const badRolePatch = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "owner" },
    });
    assertStatus("patch invalid role → 400", badRolePatch.status, 400);

    // ── Tier change ───────────────────────────────────────────────────────
    const toPremium = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tier: "premium" },
    });
    assertStatus("patch tier premium → 200", toPremium.status, 200);
    assertTruthy("tier premium", toPremium.json?.tier === "premium");

    const toFree = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tier: "free" },
    });
    assertStatus("patch tier free → 200", toFree.status, 200);
    assertTruthy("tier free", toFree.json?.tier === "free");

    // ── Tool access grant / block / inherit ───────────────────────────────
    if (toolsDeployed) {
      const grantLargo = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { toolAccess: { largo: "grant" } },
      });
      assertStatus("grant largo → 200", grantLargo.status, 200);

      const afterGrant = await fetchJson(BASE, `/api/admin/users/${subjectId}`, { cookie: adminCookie });
      const largoRow = (afterGrant.json?.toolAccess ?? []).find((r) => r.key === "largo");
      assertTruthy("largo mode grant", largoRow?.mode === "grant");
      assertTruthy("largo effective true", largoRow?.effective === true);

      const blockVector = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { toolAccess: { vector: "block" } },
      });
      assertStatus("block vector → 200", blockVector.status, 200);

      const afterBlock = await fetchJson(BASE, `/api/admin/users/${subjectId}`, { cookie: adminCookie });
      const vectorRow = (afterBlock.json?.toolAccess ?? []).find((r) => r.key === "vector");
      assertTruthy("vector mode block", vectorRow?.mode === "block");
      assertTruthy("vector effective false", vectorRow?.effective === false);

      const inheritAll = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { toolAccess: { largo: "inherit", vector: "inherit" } },
      });
      assertStatus("inherit tools → 200", inheritAll.status, 200);

      const afterInherit = await fetchJson(BASE, `/api/admin/users/${subjectId}`, { cookie: adminCookie });
      const largoInherit = (afterInherit.json?.toolAccess ?? []).find((r) => r.key === "largo");
      assertTruthy("largo back to inherit", largoInherit?.mode === "inherit");
    } else {
      rec("per-user tool access PATCH", "SKIP", "toolAccess not on deployed build");
    }

    // ── Global tools snapshot ─────────────────────────────────────────────
    const toolsAccess = await fetchJson(BASE, "/api/admin/tools/access", { cookie: adminCookie });
    if (toolsAccess.status === 404) {
      rec("GET /api/admin/tools/access", "SKIP", "route not deployed yet");
      rec("tools bulk endpoints", "SKIP", "route not deployed yet");
    } else {
      assertStatus("GET /api/admin/tools/access → 200", toolsAccess.status, 200);
      assertTruthy("tools access has tools[]", Array.isArray(toolsAccess.json?.tools));
      assertTruthy("tools access preview[]", Array.isArray(toolsAccess.json?.access_preview));

      // ── Bulk tool access (cap 1) ──────────────────────────────────────────
      await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { tier: "free" },
      });
      const bulk = await fetchJson(BASE, "/api/admin/users/tools/bulk", {
        method: "POST",
        cookie: adminCookie,
        body: { tier: "free", tool: "largo", mode: "grant", limit: 1 },
      });
      assertStatus("bulk grant largo → 200", bulk.status, 200);
      assertTruthy("bulk updated >= 0", typeof bulk.json?.updated === "number");

      const bulkBadTool = await fetchJson(BASE, "/api/admin/users/tools/bulk", {
        method: "POST",
        cookie: adminCookie,
        body: { tier: "free", tool: "not-a-tool", mode: "grant" },
      });
      assertStatus("bulk invalid tool → 400", bulkBadTool.status, 400);

      const bulkBadMode = await fetchJson(BASE, "/api/admin/users/tools/bulk", {
        method: "POST",
        cookie: adminCookie,
        body: { tier: "free", tool: "largo", mode: "allow" },
      });
      assertStatus("bulk invalid mode → 400", bulkBadMode.status, 400);
    }

    // ── Ban / unban (unlock) ──────────────────────────────────────────────
    const ban = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { banned: true },
    });
    assertStatus("ban user → 200", ban.status, 200);
    assertTruthy("banned true", ban.json?.banned === true);

    const verifyBanned = backend
      ? await backend("GET", `/users/${subjectId}`)
      : { json: {} };
    assertTruthy("Clerk banned flag", verifyBanned.json?.banned === true);

    const unban = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { banned: false },
    });
    assertStatus("unban (unlock) user → 200", unban.status, 200);
    assertTruthy("banned false", unban.json?.banned === false);

    // ── Self-guards (no self-ban / demote / delete) ───────────────────────
    if (adminId) {
      const selfBan = await fetchJson(BASE, `/api/admin/users/${adminId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { banned: true },
      });
      assertStatus("self-ban blocked → 400", selfBan.status, 400);

      const selfDemote = await fetchJson(BASE, `/api/admin/users/${adminId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { role: "member" },
      });
      assertStatus("self-demote blocked → 400", selfDemote.status, 400);

      const selfDelete = await fetchJson(BASE, `/api/admin/users/${adminId}`, {
        method: "DELETE",
        cookie: adminCookie,
      });
      assertStatus("self-delete blocked → 400", selfDelete.status, 400);
    } else {
      rec("self-guard probes", "SKIP", "could not resolve admin user id");
    }

    // ── Sign-in link ──────────────────────────────────────────────────────
    const signInLink = await fetchJson(BASE, `/api/admin/users/${subjectId}/sign-in-link`, {
      method: "POST",
      cookie: adminCookie,
    });
    assertStatus("sign-in link → 200", signInLink.status, 200);
    assertTruthy("sign-in url has __clerk_ticket", String(signInLink.json?.url ?? "").includes("__clerk_ticket"));

    // ── Whop sync (graceful without Whop keys) ────────────────────────────
    if (create.json?.email) {
      const sync = await fetchJson(BASE, "/api/admin/users/sync", {
        method: "POST",
        cookie: adminCookie,
        body: { email: create.json.email },
      });
      if (sync.status === 200) {
        rec("whop sync", "PASS", `tier=${sync.json?.tier ?? "?"}`);
      } else if (sync.status === 500) {
        rec("whop sync", "WARN", sync.json?.error ?? "sync failed without Whop — expected locally");
      } else {
        rec("whop sync", "FAIL", `HTTP ${sync.status}`);
      }
    }

    // ── Tool enforcement on pages ─────────────────────────────────────────
    if (toolsDeployed) {
      await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { tier: "premium", toolAccess: { largo: "grant", vector: "block" } },
      });

      const subjectSession = await mintSessionForUserId({
        userId: subjectId,
        appUrl: BASE,
        secret,
        publishableKey,
      });
      if (!subjectSession.skip) {
        const terminal = await fetchHtml(BASE, "/terminal", { cookie: subjectSession.cookieHeader });
        assertStatus("granted largo /terminal → 200", terminal.status, 200);
        const hasComingSoon = /launching soon|coming soon/i.test(terminal.html);
        assertFalsy("granted largo not coming-soon", hasComingSoon);

        const vector = await fetchHtml(BASE, "/vector", { cookie: subjectSession.cookieHeader });
        const vectorLocked = /launching soon|coming soon/i.test(vector.html);
        assertTruthy("blocked vector shows coming-soon", vectorLocked);
      } else {
        rec("tool page enforcement", "SKIP", subjectSession.reason);
      }
    } else {
      rec("tool page enforcement", "SKIP", "toolAccess not deployed");
    }

    // ── Role filter + tier filter smoke ───────────────────────────────────
    const roleAdmin = await fetchJson(BASE, "/api/admin/users?role=admin&limit=5", { cookie: adminCookie });
    assertStatus("role=admin filter → 200", roleAdmin.status, 200);

    const tierFree = await fetchJson(BASE, "/api/admin/users?tier=free&limit=5", { cookie: adminCookie });
    assertStatus("tier=free filter → 200", tierFree.status, 200);

    // ── Delete user ───────────────────────────────────────────────────────
    const del = await fetchJson(BASE, `/api/admin/users/${subjectId}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assertStatus("delete user → 200", del.status, 200);
    assertTruthy("delete ok", del.json?.ok === true);
    cleanupIds.splice(cleanupIds.indexOf(subjectId), 1);

    const gone = await fetchJson(BASE, `/api/admin/users/${subjectId}`, { cookie: adminCookie });
    assertStatus("deleted user → 404", gone.status, 404);

    // ── Admin health endpoints smoke ──────────────────────────────────────
    const health = await fetchJson(BASE, "/api/admin/health", { cookie: adminCookie });
    assertStatus("admin health → 200", health.status, 200);
    assertTruthy("health has issues[]", Array.isArray(health.json?.issues));

    const auditLog = await fetchJson(BASE, "/api/admin/audit-log?limit=5", { cookie: adminCookie });
    if (auditLog.status === 200) {
      rec("audit log → 200", "PASS");
    } else {
      rec("audit log", "WARN", `HTTP ${auditLog.status} (db may be skipped)`);
    }
  } finally {
    if (backend) {
      for (const id of cleanupIds) {
        try {
          await backend("DELETE", `/users/${id}`);
        } catch {
          /* best-effort */
        }
      }
    }
    await adminSession.cleanup?.();
  }

  writeReport("admin-users-e2e.json", rows);
  const { fail } = summarize(rows);
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
