import assert from "node:assert/strict";
import { test } from "node:test";
import { WELCOME_SEQUENCE } from "./welcome-sequence.ts";

// Regression for a live bug: the Day 6 "trust/honesty" email's caption claims the full
// win-and-loss track record "is public" and links to it — but it linked to `/track-record`,
// which `src/app/(site)/track-record/page.tsx` redirects to `/admin?tab=track-record`
// (guarded by requireAdmin() in src/app/(site)/admin/layout.tsx). A non-admin member clicking
// this email's own trust-claim link could never actually open the page it promised. The
// genuinely public win/loss record lives at `/methodology` (buildPublicTrackRecord), the same
// route RedesignHome.tsx already links as "Public track record".

function buildDay6Html(): string {
  const day6 = WELCOME_SEQUENCE.find((s) => s.step === 4);
  assert.ok(day6, "Day 6 (step 4) welcome-sequence email not found");
  return day6!.build({ email: "member@example.com", firstName: "Alex" }).html;
}

test("welcome-sequence Day 6: the public-record claim links to the genuinely public /methodology page", () => {
  const html = buildDay6Html();
  assert.match(html, /href="https:\/\/[^"]*\/methodology"/, "caption must link to /methodology");
});

test("welcome-sequence Day 6: never links to the admin-gated /track-record URL", () => {
  const html = buildDay6Html();
  assert.doesNotMatch(
    html,
    /href="https:\/\/[^"]*\/track-record"/,
    "/track-record redirects to an admin-gated page a non-admin reader can never open"
  );
});
