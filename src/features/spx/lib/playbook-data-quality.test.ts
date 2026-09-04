import test from "node:test";
import assert from "node:assert/strict";
import {
  isDegradedForLivePlaybook,
  liveDataQualityMode,
  playbookDataQualityFlags,
  shouldFailClosedLiveOnDataQuality,
} from "./playbook-data-quality";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

test("playbookDataQualityFlags: future polled_at treated as stale", () => {
  const future = new Date(Date.now() + 120_000).toISOString();
  const desk = {
    polled_at: future,
    gex_walls: [{}],
    halt_channel_stale: false,
  } as SpxDeskPayload;
  const flags = playbookDataQualityFlags(desk);
  assert.equal(flags.desk_stale, true);
});

test("isDegradedForLivePlaybook: blocks event PB on halt stale via capabilities", () => {
  const desk = { halt_channel_stale: true, polled_at: new Date().toISOString(), gex_walls: [{}] } as SpxDeskPayload;
  const flags = playbookDataQualityFlags(desk);
  assert.equal(isDegradedForLivePlaybook("PB-03", flags, desk), true);
  assert.equal(isDegradedForLivePlaybook("PB-01", flags, desk), false);
});

test("liveDataQualityMode: severe when 2+ feed issues", () => {
  assert.equal(
    liveDataQualityMode({ halt_channel_stale: true, desk_stale: true, gex_missing: false }),
    "severe"
  );
  assert.equal(
    liveDataQualityMode({ halt_channel_stale: true, desk_stale: false, gex_missing: false }),
    "degraded"
  );
  assert.equal(
    liveDataQualityMode({ halt_channel_stale: false, desk_stale: false, gex_missing: false }),
    "normal"
  );
  assert.equal(shouldFailClosedLiveOnDataQuality("severe"), true);
  assert.equal(shouldFailClosedLiveOnDataQuality("degraded"), false);
});
