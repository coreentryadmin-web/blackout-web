# FULL PRODUCT CERTIFICATION — X & BRAND MARKETING

Ordered directly by the user, relayed by the coordinator, adapted to your lane's actual shape — your
"product" is BLACKOUT's public X presence and the pipeline that produces it, not panels/charts. This
is separate from, and takes priority ranking over, whatever session-restriction confirmation you may
be blocked on — if that's still awaiting a decision only the user can make, leave it exactly as is
and start this certification in parallel; don't let it block starting.

## 1. Inventory everything
Every content pipeline you run: the hourly live-newsroom reaction, the brand/educational content
pillar, every automated post type, every visual-proof template pulled from a live product, the
growth/engagement/analytics stack (`x-growth`, `x-replies`, `x-analytics`, `src/lib/x-rate-budget.ts`),
every scheduled cron (`x-autopost` and siblings — note `cron-dst-audit.mjs` already found
`x-autopost` broken under EST, confirm that's actually fixed and re-measure rather than trusting the
old finding).

## 2. Validate every number and claim
Every number that appears in a post (a win rate, a P&L, a "X% conviction") — trace it back to the
exact product screenshot/data it claims to represent, at the exact moment posted. `send:emails`'s own
history shows a two-losing-trades screenshot went out under alt text promising wins (#1911) — that
class of defect is exactly what this certification exists to catch systematically. Audit a real
sample of recent posts against the underlying product state at post time.

## 3. Validate every label
Does a post's claimed signal/setup match what the product actually flagged? Does an educational
post's product description match the CURRENT product (not last month's)? Does a "live" market
reaction actually reflect a live/fresh screenshot, or a stale one?

## 4. Validate every content type
For each content type/template: why does it exist, does it serve growth or brand voice, is it
redundant with another type, does its cadence match what the growth data says works, should any be
retired.

## 5. Test every interaction / pipeline stage
Walk a real post end to end: trigger detection → visual-proof capture from the live product → copy
generation → scheduling → publish → engagement tracking. Confirm each stage's output at each step,
not just that the final tweet appeared.

## 6. Validate the logic
Trigger/detection thresholds for "this is newsroom-worthy right now" — measured or arbitrary?
Rate-budget logic in `x-rate-budget.ts` — does it actually prevent over-posting, has it ever been hit?

## 7. Audit the architecture
Map the pipeline end to end, identify fragile dependencies (a product page rendering differently
breaking the visual-proof capture), single points of failure, observability gaps (do you know WHY a
post underperformed?).

## 8. Performance certification
Time from market event to post published — measure it, don't assume it's fast enough to matter as
"live."

## 9. Product & UX review
Think like a prospective member scrolling the X account cold — is the newsroom pillar differentiated
and credible? Is the brand pillar actually building trust or diluting the newsroom's strength (your
own brief already names this risk)?

## 10. Find new features / growth opportunities
USER PROBLEM (follower/engagement), PROPOSED CAPABILITY, WHY CURRENT CONTENT DOESN'T SOLVE IT, DATA
REQUIRED, EXPECTED VALUE, COMPLEXITY, RISK, HOW MEASURED. Classify P0/P1/P2/P3.

## 11. Competitive review
What do the best trading-intel X accounts do that BLACKOUT's doesn't? What does BLACKOUT's account
already do better (live product-sourced proof most competitors fake or don't have)? Where are
competitors weak that BLACKOUT's real data could exploit?

## 12. Find what wasn't asked about
What would a growth marketer flag? What would a compliance-minded reviewer flag about a claimed win
rate or testimonial? What happens to the pipeline during an extreme market session (does volume of
real signal outstrip the rate budget)?

## 13. Evidence — certification matrix
Commit `docs/audit/X-CONTENT-CERTIFICATION.md`: COMPONENT | CLAIM/INTERACTION | SOURCE/LOGIC |
VALIDATION PERFORMED | RESULT | ISSUE | SEVERITY | ACTION | EVIDENCE | STATUS (NOT TESTED/TESTING/
FAILED/FIXING/DEPLOYED/LIVE VERIFIED). Nothing is LIVE VERIFIED without production evidence.

## Reporting back
Every real defect gets the standard fix/branch/test/findings-staging/PR treatment per CLAUDE.md —
P0s first (a false/stale claim in a live post is P0, treat it that way). The coordinator pulls status
on its own cycle — front-load anything P0 into a PR. No permanent DONE.
