import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { widenSessionExtremesWithSpot } from "./spx-session";

describe("widenSessionExtremesWithSpot", () => {
  it("widens HOD/LOD to include live spot during RTH", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, 7392.95, 7294.18, true);
    assert.equal(hod, 7440.43);
    assert.equal(lod, 7294.18);
  });

  it("does not fabricate extremes from spot when HOD/LOD are null", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, null, null, true);
    assert.equal(hod, null);
    assert.equal(lod, null);
  });

  it("leaves extremes unchanged when market is closed", () => {
    const { hod, lod } = widenSessionExtremesWithSpot(7440.43, 7392.95, 7294.18, false);
    assert.equal(hod, 7392.95);
    assert.equal(lod, 7294.18);
  });
});
