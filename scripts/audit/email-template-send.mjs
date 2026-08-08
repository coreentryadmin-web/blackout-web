/**
 * Renders EVERY production email template and sends each one to a single test inbox.
 *
 * Uses the REAL template builders and the REAL sendEmail() — nothing is reimplemented — so what
 * lands in the inbox is byte-identical to what a member would receive, inline images, one-click
 * unsubscribe headers and all. Read-only w.r.t. the app: no DB writes, no Clerk, no prod request.
 *
 * Why this exists: most of these templates fire only on a real billing event (a failed charge, a
 * downgrade, a cancellation reversal), so in practice nobody ever looks at them after the day they
 * were written. The one time we did, the day-6 email turned out to be shipping a screenshot of two
 * losing trades under alt text promising wins — see #1911. This makes "show me every email we send"
 * a 30-second command instead of a research project.
 *
 * Usage (from the repo root):
 *   RESEND_API_KEY=... RESEND_TOPIC_MARKETING_ID=... \
 *     npx tsx scripts/audit/email-template-send.mjs --to=you@example.com [--dry-run]
 *
 * --dry-run prints the subject, attachment count, whether the footer carries an unsubscribe link
 * and how many headers each send would set, without contacting Resend. Run it first: with no
 * RESEND_API_KEY the unsubscribe links and RFC 8058 headers cannot be signed, and the dry run
 * shows that as `unsub=no hdrs=0` rather than failing silently at send time.
 *
 * Never prints a secret. Sends are paced at ~700ms because Resend's default account limit is
 * 2 requests/second.
 */
import { sendEmail } from "@/lib/email/resend-client";
import { gexCheatSheetEmail } from "@/lib/email/templates/gex-cheat-sheet";
import { WELCOME_SEQUENCE } from "@/lib/email/templates/welcome-sequence";
import { welcomeCommunityEmail } from "@/lib/email/templates/welcome-community";
import { welcomePremiumEmail } from "@/lib/email/templates/welcome-premium";
import { downgradeEmail } from "@/lib/email/templates/downgrade";
import { paymentFailedEmail } from "@/lib/email/templates/payment-failed";
import { scheduledCancelEmail } from "@/lib/email/templates/scheduled-cancel";
import { cancelReversedEmail } from "@/lib/email/templates/cancel-reversed";
import { accessEndedEmail } from "@/lib/email/templates/access-ended";
import { marketingUnsubscribe } from "@/lib/email/unsubscribe-token";

const TO = process.argv.find((a) => a.startsWith("--to="))?.slice(5);
const DRY = process.argv.includes("--dry-run");
if (!TO) {
  console.error("usage: --to=<email> [--dry-run]");
  process.exit(2);
}

const NAME = "Vinay";
const TOPIC = process.env.RESEND_TOPIC_MARKETING_ID;

/** Marketing sends carry the RFC 8058 headers + topic; lifecycle sends deliberately do not. */
const mkt = marketingUnsubscribe(TO);

const sends = [];

// --- Lead magnet (the exit-intent capture reply) -----------------------------
{
  const e = gexCheatSheetEmail(TO);
  sends.push({ kind: "lead-magnet · gex-cheat-sheet", tag: "cheat-sheet", topicId: TOPIC, ...e });
}

// --- Welcome sequence, all 5 steps -------------------------------------------
for (const step of WELCOME_SEQUENCE) {
  const e = step.build({ email: TO, firstName: NAME });
  sends.push({
    kind: `welcome-sequence · step ${step.step} (day ${step.delayDays})`,
    tag: `welcome-seq-${step.step}`,
    topicId: TOPIC,
    ...e,
  });
}

// --- Lifecycle / billing (transactional — no unsubscribe, no topic) ----------
const lifecycle = [
  ["lifecycle · welcome-community (new SPX Slayer)", "welcome-community", welcomeCommunityEmail({ firstName: NAME })],
  [
    "lifecycle · welcome-premium (free → Premium, monthly)",
    "welcome-premium-from-free",
    welcomePremiumEmail({ firstName: NAME, previousTier: "free", billingInterval: "monthly" }),
  ],
  [
    "lifecycle · welcome-premium (SPX Slayer → Premium, annual)",
    "welcome-premium-upgrade",
    welcomePremiumEmail({ firstName: NAME, previousTier: "community", billingInterval: "annual" }),
  ],
  ["lifecycle · downgrade (Premium → SPX Slayer)", "downgrade", downgradeEmail({ firstName: NAME })],
  ["lifecycle · payment-failed (dunning)", "payment-failed", paymentFailedEmail({ firstName: NAME, graceDays: 7 })],
  [
    "lifecycle · scheduled-cancel",
    "scheduled-cancel",
    scheduledCancelEmail({ firstName: NAME, accessUntil: new Date("2026-09-14T00:00:00Z") }),
  ],
  ["lifecycle · cancel-reversed", "cancel-reversed", cancelReversedEmail({ firstName: NAME })],
  ["lifecycle · access-ended", "access-ended", accessEndedEmail({ firstName: NAME, previousTier: "premium" })],
];
for (const [kind, tag, e] of lifecycle) sends.push({ kind, tag, topicId: null, ...e });

// -----------------------------------------------------------------------------
console.log(`${sends.length} templates → ${TO}${DRY ? "  (DRY RUN — nothing sent)" : ""}\n`);

let ok = 0;
let failed = 0;
for (const s of sends) {
  const hasUnsub = /&gt;Unsubscribe&lt;|>Unsubscribe</.test(s.html);
  const meta = `att=${(s.attachments ?? []).length} unsub=${hasUnsub ? "yes" : "no"} hdrs=${Object.keys(s.headers ?? {}).length}`;
  if (DRY) {
    console.log(`  [dry] ${s.kind}\n        "${s.subject}"  ${meta}`);
    continue;
  }
  const r = await sendEmail({
    to: TO,
    subject: s.subject,
    html: s.html,
    attachments: s.attachments,
    headers: s.headers,
    tag: s.tag,
    topicId: s.topicId,
  });
  if (r.ok) ok++;
  else failed++;
  console.log(`  ${r.ok ? "SENT" : "FAIL"}  ${s.kind}\n        "${s.subject}"  ${meta}${r.ok ? `  id=${r.id}` : `  err=${r.error}`}`);
  // Resend's default account limit is 2 requests/second.
  await new Promise((res) => setTimeout(res, 700));
}

if (!DRY) console.log(`\n${ok} sent, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
