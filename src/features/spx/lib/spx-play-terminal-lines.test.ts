import test from "node:test";
import assert from "node:assert/strict";
import { buildPlayTerminalLines, buildPlaybookTerminalLines } from "./spx-play-terminal-lines";
import type { SpxPlayPayload } from "./spx-play-engine";

test("buildPlayTerminalLines: structure HOLD includes VWAP and WHY HOLD", () => {
  const play = {
    action: "HOLD",
    direction: "short",
    headline: "HOLD — defending put wall",
    thesis: "Dealers pressing below flip.",
    factors: [{ label: "Gamma", weight: -2, detail: "Below flip — sell dips" }],
    levels: { entry: 7450, stop: 7465, target: 7420, invalidation: "Reclaim flip" },
    confirmations: null,
    open_play: {
      id: 1,
      direction: "short",
      entry_price: 7450,
      stop: 7465,
      target: 7420,
      grade: "A",
      opened_at: "2026-07-10T14:00:00.000Z",
      mfe_pts: 6,
      trim_done: false,
      option_label: "7450P",
    },
  } as SpxPlayPayload;

  const lines = buildPlayTerminalLines({
    selected: {
      id: "structure-open",
      chip: { id: "structure-open", column: "open", kind: "structure", label: "7450 P", prefix: "STR", tone: "put" },
      stages: ["hold", "trim", "sell"],
      activeStage: "hold",
      trimDone: false,
    },
    play,
    lotto: null,
    powerHour: null,
    desk: {
      price: 7442,
      vwap: 7454,
      above_vwap: false,
      flow_0dte_net: -120_000,
    } as never,
    confirmationLayer: null,
  });

  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /WHY HOLD/);
  assert.match(text, /Below VWAP/);
  assert.match(text, /0DTE flow/);
  assert.match(text, /Gamma/);
});

test("buildPlaybookTerminalLines: empty panel shows awaiting copy when session live", () => {
  const lines = buildPlaybookTerminalLines(null, true);
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /PLAYBOOK VALIDATION/);
  assert.match(text, /Awaiting technicals/);
});

test("buildPlaybookTerminalLines: verdicts render PB rows", () => {
  const lines = buildPlaybookTerminalLines(
    {
      mode: "shadow",
      primary_playbook_id: "PB-01",
      verdicts: [
        {
          playbook_id: "PB-01",
          name: "Open Drive",
          trigger_fired: true,
          precondition_match: true,
          session_window_open: true,
          direction: "long",
          detail: "Gap-and-go above VWAP",
          primary: true,
        },
      ],
    },
    true
  );
  const text = lines.map((l) => l.text).join("\n");
  assert.match(text, /Primary trigger: PB-01/);
  assert.match(text, /PB-01 · Open Drive/);
  assert.match(text, /Trigger: long/);
});
