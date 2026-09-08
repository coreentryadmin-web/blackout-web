// Swing Command — frozen scale-out exit policy for the terminal ladder (PR P0).
// Mirrors SCALE_OUT_RULES from zerodte/scale-out.ts; swings always render trim_scale.

import type { TerminalPolicyInput } from "@/lib/zerodte/terminal-ladder";
import { SCALE_OUT_RULES } from "@/lib/zerodte/scale-out";

/** Default swing exit policy — 50% at 2×, −60% hard stop, trail runner off peak. */
export const SWING_SCALE_OUT_POLICY: TerminalPolicyInput = {
  policy: "trim_scale",
  hard_stop_pct: Math.round((SCALE_OUT_RULES.hard_stop_mult - 1) * 100),
  target_pct: Math.round((SCALE_OUT_RULES.scale_at_mult - 1) * 100),
  trim_levels: [
    {
      trigger_pct: Math.round((SCALE_OUT_RULES.scale_at_mult - 1) * 100),
      fraction: SCALE_OUT_RULES.scale_fraction,
    },
  ],
  runner_fraction: 1 - SCALE_OUT_RULES.scale_fraction,
  // Multi-session swings do not use the 0DTE 15:50 time-stop clock — value is inert for SWING UI.
  time_stop_et: "16:00",
};
