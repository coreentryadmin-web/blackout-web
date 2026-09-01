import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeCatalystBriefs, type CatalystBriefInput } from "./meridian-catalyst-enrich-core";

function catalyst(overrides: Partial<CatalystBriefInput>): CatalystBriefInput {
  return {
    channel: "guidance",
    type: "guidance",
    title: "",
    published: "2026-08-25T12:00:00Z",
    ...overrides,
  };
}

// Live evidence (2026-08-25, DKS earnings): every catalyst_briefs item tagged type:"guidance" was
// a sell-side analyst rating/PT note, not corporate guidance -- and the identical headline already
// appears, correctly labeled, under `analyst_revisions`. This is the regression test for that.
test("shapeCatalystBriefs: drops a 'guidance'-typed item that is really an analyst PT action", () => {
  const out = shapeCatalystBriefs([
    catalyst({ title: "JP Morgan Maintains Overweight on Dick's Sporting Goods, Lowers Price Target to $245" }),
    catalyst({ title: "Wells Fargo Upgrades Dick's Sporting Goods to Overweight, Raises Price Target to $240" }),
  ]);
  assert.equal(out.length, 0, "both are analyst actions mislabeled as guidance, both dropped");
});

test("shapeCatalystBriefs: a real guidance headline (no analyst-action keywords) is kept", () => {
  const out = shapeCatalystBriefs([
    catalyst({ title: "Dick's Sporting Goods Raises Full-Year Revenue Guidance" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.type, "guidance");
});

test("shapeCatalystBriefs: the analyst-action filter only applies to the 'guidance' type", () => {
  // Same keyword ("upgrade") inside an m&a-typed headline must NOT be filtered -- the guard is
  // scoped to the channel this defect was found in, not to the keyword pattern generally.
  const out = shapeCatalystBriefs([
    catalyst({ type: "m&a", title: "Acquirer Upgrades Offer to $50/share in Revised Bid" }),
  ]);
  assert.equal(out.length, 1);
});

test("shapeCatalystBriefs: non-guidance types (buyback, insider, m&a) pass through unfiltered", () => {
  const out = shapeCatalystBriefs([
    catalyst({ type: "buyback", title: "Company Announces $1B Share Buyback Program" }),
    catalyst({ type: "insider", title: "CEO Purchases 10,000 Shares" }),
  ]);
  assert.equal(out.length, 2);
});

test("shapeCatalystBriefs: caps at 8 and drops types outside the allowlist", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    catalyst({ type: "buyback", title: `Buyback update ${i}` })
  );
  rows.push(catalyst({ type: "short", title: "Short interest report" }));
  const out = shapeCatalystBriefs(rows);
  assert.equal(out.length, 8);
});
