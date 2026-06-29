import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Regression guard for React #418: FreshnessChip renders on every live value, so its server markup
// must be deterministic (independent of Date.now()/timezone). Before the fix it emitted a relative
// age (`· 5s`) and a locale-formatted `title`, both evaluated from the server clock — which never
// matched the client's first render and forced a full-page hydration re-render.

// The component is transpiled with the classic JSX runtime in this test context, which expects a
// global `React`. Make it available before importing the component.
(globalThis as unknown as { React: typeof React }).React = React;

async function render(asOf: Date): Promise<string> {
  const { FreshnessChip } = await import("./FreshnessChip");
  return renderToStaticMarkup(React.createElement(FreshnessChip, { status: "live", asOf }));
}

test("FreshnessChip SSR markup is time-independent (no age, no locale title)", async () => {
  const html = await render(new Date(Date.now() - 5_000)); // 5s ago — the <60s exact-seconds path
  assert.ok(!html.includes("·"), "server markup must not include the relative-age separator");
  assert.ok(!/title=/.test(html), "server markup must not include a locale-formatted title");
  assert.ok(html.includes("Live"), "status word should still render on the server");
});

test("FreshnessChip SSR markup is stable across repeated renders at different clock times", async () => {
  const a = await render(new Date(Date.now() - 3_000));
  const b = await render(new Date(Date.now() - 41_000));
  assert.equal(a, b, "server markup must not depend on how long ago asOf was");
});
