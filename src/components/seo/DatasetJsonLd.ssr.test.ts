import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE } from "@/lib/site";

// GEO guard: Dataset markup is the machine-readable form of a quantified claim — it must carry
// every variable as a real PropertyValue (name + value, unit when applicable) and stay bound to
// the Organization entity, the same way DefinedTermSetJsonLd binds glossary terms.

(globalThis as unknown as { React: typeof React }).React = React;

test("Dataset emits one PropertyValue per variable, bound to the Organization entity", async () => {
  const { DatasetJsonLd } = await import("./JsonLd");
  const html = renderToStaticMarkup(
    React.createElement(DatasetJsonLd, {
      path: "/methodology",
      name: "BlackOut SPX Slayer public track record",
      description: "Live-graded win/loss aggregate.",
      dateModified: "2026-09-10T00:00:00.000Z",
      measurementTechnique: "Aggregate win/loss tally over every closed play.",
      variables: [
        { name: "Win rate", value: 62, unitText: "percent" },
        { name: "Total closed plays", value: 141 },
      ],
    }),
  );
  const m = html.match(/<script type="application\/ld\+json">(.*)<\/script>/);
  assert.ok(m, "expected a JSON-LD script tag");
  const data = JSON.parse(m![1]);

  assert.equal(data["@type"], "Dataset");
  assert.equal(data["@id"], `${SITE.url}/methodology#dataset`);
  assert.equal(data.url, `${SITE.url}/methodology`);
  // bound to the Organization entity so the claim inherits topical authority, same as DefinedTermSet
  assert.deepEqual(data.creator, { "@id": `${SITE.url}/#organization` });
  assert.equal(data.dateModified, "2026-09-10T00:00:00.000Z");

  const vars = data.variableMeasured as { "@type": string; name: string; value: number; unitText?: string }[];
  assert.equal(vars.length, 2, "one PropertyValue per variable, no drift");
  assert.equal(vars[0]["@type"], "PropertyValue");
  assert.equal(vars[0].name, "Win rate");
  assert.equal(vars[0].value, 62);
  assert.equal(vars[0].unitText, "percent");
  // a variable with no unit must not carry a stray unitText key
  assert.equal("unitText" in vars[1], false);
});

test("Methodology page omits the Dataset claim entirely when the track record is unavailable", async () => {
  // Mirrors TrackRecordEmbed's own discipline (src/components/embeds/TrackRecordEmbed.tsx:
  // "embed must never render a fabricated 0W/0L when no data is available") — a Dataset claiming
  // a 0% win rate over 0 plays is not an honest absence, it is a false quantitative claim, so the
  // page must omit the component rather than render it with zeroed-out variables.
  const pageSource = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../../app/(marketing)/methodology/page.tsx", import.meta.url), "utf8"),
  );
  assert.match(
    pageSource,
    /\{spxRecord\.available\s*&&\s*\(\s*<DatasetJsonLd/,
    "DatasetJsonLd must be gated on spxRecord.available",
  );
});
