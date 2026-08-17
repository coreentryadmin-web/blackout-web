import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreSocialAnswer } from "./social-answer-quality";

describe("scoreSocialAnswer", () => {
  it("GREEN when Post section has copy, hooks, workflow, CTA", () => {
    const answer = `## Verdict
Bearish below flip.

## Post
**Copy**
SPX pinned below flip — dealers short gamma into the bell. What's your line?

**Alt hooks**
- Flow turned before price broke
- Wall held twice — third test matters

**CTA**
Link in bio for pricing; Discord for live desk reads.

**Screenshot workflow**
1. Open /heatmap → search SPX
2. Open /flows → #helix-ticker-search SPX`;

    const s = scoreSocialAnswer(answer);
    assert.equal(s.verdict, "GREEN");
    assert.equal(s.hasCopy, true);
    assert.ok(s.altHookCount >= 2);
  });

  it("RED when vendor name leaks", () => {
    const s = scoreSocialAnswer("## Post\n**Copy**\nData from Unusual Whales shows puts.");
    assert.equal(s.verdict, "RED");
    assert.ok(s.issues.includes("vendor-leak"));
  });
});
