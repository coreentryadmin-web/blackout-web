import { test } from "node:test";
import assert from "node:assert/strict";
import type { BenzingaCatalyst } from "@/lib/providers/polygon";

// edition-builder.ts's import chain reaches `import "server-only"` transitively (via
// dossier.ts -> gex-positioning.ts) -- same stub edition-builder-scoring-snapshot.test.ts uses
// for this boundary. Must register BEFORE edition-builder.ts is ever imported, and ESM static
// imports evaluate before any module-body statement runs -- so edition-builder.ts is loaded
// with a dynamic `await import()` inside each test, after this mock is registered, exactly like
// the sibling test file does for its own exports.
import { mock } from "node:test";
mock.module("server-only", { namedExports: {} });

function catalyst(title: string): BenzingaCatalyst {
  return { channel: "m&a", type: "m&a", title, published: "2026-11-01T22:00:00Z" };
}

test("sanitizedAfterHoursCatalysts decodes HTML entities in title so raw &#39; never reaches the API/model", async () => {
  const { sanitizedAfterHoursCatalysts } = await import("./edition-builder");
  const raw = catalyst(
    "12 Consumer Discretionary Stocks Moving In Friday&#39;s After-Market Session",
  );
  const out = sanitizedAfterHoursCatalysts([raw]);
  assert.equal(
    out[0]!.title,
    "12 Consumer Discretionary Stocks Moving In Friday's After-Market Session",
  );
  assert.doesNotMatch(out[0]!.title, /&#39;/);
});

test("sanitizedAfterHoursCatalysts preserves the other catalyst fields untouched", async () => {
  const { sanitizedAfterHoursCatalysts } = await import("./edition-builder");
  const raw = catalyst("Alphabet Posts Worst Week Since 2011 &#8212; Warsh Sees &#39;Cracks&#39;");
  const out = sanitizedAfterHoursCatalysts([raw]);
  assert.equal(out[0]!.channel, raw.channel);
  assert.equal(out[0]!.type, raw.type);
  assert.equal(out[0]!.published, raw.published);
});

test("sanitizedAfterHoursCatalysts caps at 10 and handles undefined input", async () => {
  const { sanitizedAfterHoursCatalysts } = await import("./edition-builder");
  assert.deepEqual(sanitizedAfterHoursCatalysts(undefined), []);
  const many = Array.from({ length: 15 }, (_, i) => catalyst(`Headline ${i}`));
  assert.equal(sanitizedAfterHoursCatalysts(many).length, 10);
});
