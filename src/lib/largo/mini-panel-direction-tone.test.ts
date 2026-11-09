import test from "node:test";
import assert from "node:assert/strict";
import { spxDirectionTone } from "./mini-panel";

/**
 * BUG FIX (round 511): the SPX Slayer "Action"/"Play" rows in the live Largo mini-panel
 * (`fetchMiniPanelPayload`, cfg.key === "spx-slayer") used to color their tone with
 * `(p?.action ?? "").toLowerCase().includes("short") ? "bear" : "bull"`. `action` is
 * `SpxPlayAction` (src/features/spx/lib/spx-signals.ts): `"SCANNING" | "WATCHING" | "BUY" |
 * "HOLD" | "TRIM" | "SELL"` — none of those six literals contains "short" (or "long"), so the
 * check was dead code that ALWAYS fell through to "bull", regardless of the play's real
 * direction. A short/bearish SPX Slayer play rendered a green "bull" tone on both rows.
 *
 * The real direction lives on a separate field, `play.direction` (`SpxPlayDirection | null`,
 * spx-play-payload.ts), which `spxDirectionTone` now reads directly instead of pattern-matching
 * the action text.
 */

test("spxDirectionTone colors bear for a short play (the live bug: this used to read bull)", () => {
  assert.equal(spxDirectionTone("short"), "bear");
});

test("spxDirectionTone colors bull for a long play", () => {
  assert.equal(spxDirectionTone("long"), "bull");
});

test("spxDirectionTone renders untoned (no fabricated bull) when direction is unknown/null", () => {
  assert.equal(spxDirectionTone(null), undefined);
  assert.equal(spxDirectionTone(undefined), undefined);
});

test("spxDirectionTone never matches on the action string's own vocabulary", () => {
  // Regression guard against reintroducing the dead substring check: none of SpxPlayAction's
  // six real values should ever influence the tone function directly (they aren't even its
  // input type any more), and an action-shaped string passed by mistake must not accidentally
  // resolve to "bear" the way "SHORTED" or similar text once would have.
  assert.equal(spxDirectionTone("SELL"), undefined);
  assert.equal(spxDirectionTone("HOLD"), undefined);
});
