import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSectorCohort } from "@/lib/meridian/meridian-sector-core";
import {
  peerTickersForReactionFetch,
  shapeMeridianPeerCohortForLargo,
} from "@/lib/largo/meridian-peer-cohort-for-largo-core";

describe("meridian-peer-cohort-for-largo-core", () => {
  it("caps peer reaction fetch to MAX_PEER_REACTION_TICKERS excluding subject", () => {
    const cohort = buildSectorCohort({
      subject: "DKS",
      subjectValue: 7.2,
      classification: { majorGroup: "56", label: "Apparel Retail", sicCode: null, sicDescription: null },
      peers: [
        { ticker: "BBWI", value: 5.1, date: "2026-08-20" },
        { ticker: "ULTA", value: 4.8, date: "2026-08-21" },
        { ticker: "SPWH", value: null, date: "2026-08-22" },
        { ticker: "WOOF", value: 6.0, date: "2026-08-23" },
        { ticker: "BBW", value: 5.5, date: "2026-08-24" },
        { ticker: "TITN", value: 4.2, date: "2026-08-25" },
        { ticker: "EXTRA", value: 3.9, date: "2026-08-26" },
      ],
    });
    assert.ok(cohort);
    const tickers = peerTickersForReactionFetch(cohort!, "DKS");
    assert.equal(tickers.length, 6);
    assert.ok(!tickers.includes("DKS"));
    assert.ok(!tickers.includes("SPWH"));
  });

  it("shapes cohort members with reaction history and honest interpretation", () => {
    const cohort = buildSectorCohort({
      subject: "DKS",
      subjectValue: 7.2,
      classification: { majorGroup: "56", label: "Apparel Retail", sicCode: null, sicDescription: null },
      peers: [
        { ticker: "BBWI", value: 5.1, date: "2026-08-20" },
        { ticker: "ULTA", value: 4.8, date: "2026-08-21" },
        { ticker: "SPWH", value: null, date: "2026-08-22" },
        { ticker: "WOOF", value: 6.0, date: "2026-08-23" },
        { ticker: "BBW", value: 5.5, date: "2026-08-24" },
      ],
    });

    const shaped = shapeMeridianPeerCohortForLargo({
      event_id: "earnings:DKS:2026-08-25",
      subject_ticker: "DKS",
      cohort,
      reactions: [
        { ticker: "BBWI", avgReactionPct: -2.5, beatRate: 0.75, n: 4 },
        { ticker: "ULTA", avgReactionPct: 1.2, beatRate: 0.5, n: 4 },
      ],
    });

    assert.equal(shaped.event_id, "earnings:DKS:2026-08-25");
    assert.equal(shaped.subject_ticker, "DKS");
    assert.match(shaped.position_summary ?? "", /Apparel Retail/);
    assert.equal(shaped.members.find((m) => m.ticker === "DKS")?.is_subject, true);
    const bbwi = shaped.members.find((m) => m.ticker === "BBWI");
    assert.equal(bbwi?.avg_reaction_pct, -2.5);
    assert.equal(bbwi?.beat_rate, 0.75);
    assert.equal(bbwi?.reaction_sample_n, 4);
    const spwh = shaped.members.find((m) => m.ticker === "SPWH");
    assert.equal(spwh?.avg_reaction_pct, null);
    assert.equal(spwh?.reaction_sample_n, 0);
    assert.match(shaped.interpretation, /unknown, not zero/);
  });
});
