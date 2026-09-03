import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  observeSpxDeskVoiceTransitions,
  resetSpxVoiceFeedObserverForTests,
  voiceEventsToFeedEntries,
} from "./spx-voice-feed-store";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

function mkDesk(price: number, flip: number): SpxDeskPayload {
  return {
    available: true,
    price,
    gamma_flip: flip,
    polled_at: new Date().toISOString(),
    gex_walls: [],
  } as SpxDeskPayload;
}

describe("spx-voice-feed-store", () => {
  test("voiceEventsToFeedEntries maps event lines", () => {
    const entries = voiceEventsToFeedEntries(
      [{ key: "flip", kind: "flip-cross", tone: "bull", line: "γ flip reclaimed" }],
      "2026-09-02",
      1_000
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.line, "γ flip reclaimed");
    assert.equal(entries[0]!.session_date, "2026-09-02");
  });

  test("observeSpxDeskVoiceTransitions seeds first snapshot without events", async () => {
    resetSpxVoiceFeedObserverForTests();
    const events = await observeSpxDeskVoiceTransitions(mkDesk(7500, 7520), "2026-09-02");
    assert.deepEqual(events, []);
  });

  test("observeSpxDeskVoiceTransitions emits on gamma flip cross", async () => {
    resetSpxVoiceFeedObserverForTests();
    const session = "2026-09-02";
    await observeSpxDeskVoiceTransitions(mkDesk(7500, 7520), session);
    const events = await observeSpxDeskVoiceTransitions(mkDesk(7530, 7520), session);
    assert.ok(events.length >= 1);
    assert.equal(events[0]!.kind, "flip-cross");
  });
});
