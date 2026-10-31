import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * Regression (round 139, DISCOVERY lane): `IosNativeSegment`'s active-tab indicator used a
 * HARDCODED, literal Framer Motion `layoutId` ("ios-native-segment-indicator") shared by every
 * instance of the component on the page. Framer Motion requires `layoutId` to be unique among
 * simultaneously-mounted elements — when two carry the same id it treats them as ONE logical
 * element, and only the most-recently-mounted copy's indicator pill stays visible; the other
 * instance's active tab silently loses its highlight.
 *
 * This is not a hypothetical: `HelixPageShell` mounts BOTH `IosIntelligenceHubSegment` (the
 * Flow/Thermal switcher) and `FlowFeed`'s own "Live tape / Analytics" lens switcher — both
 * `IosNativeSegment` instances — on the native iOS `/flows` page at the same time, both with an
 * active tab, both rendering their own `<motion.span layoutId="ios-native-segment-indicator" />`.
 *
 * Mocks `framer-motion`'s `motion.span` with a plain element that threads `layoutId` through as a
 * `data-layout-id` attribute, so the id Framer Motion would actually receive is inspectable from
 * the rendered HTML without needing Framer Motion's real animation runtime (which
 * renderToStaticMarkup can't exercise anyway). mock.module() resolves bare specifiers relative to
 * this file and ESM caches a module on first import, so the mock is installed once, before the
 * real component module is ever imported — same pattern as src/app/api/platform/intel/route.test.ts.
 */
mock.module("framer-motion", {
  namedExports: {
    motion: {
      span: ({
        layoutId,
        className,
        children,
      }: {
        layoutId?: string;
        className?: string;
        children?: React.ReactNode;
      }) =>
        React.createElement(
          "span",
          { className, "data-layout-id": layoutId ?? "" },
          children
        ),
    },
  },
});

type View = "a" | "b";
const SEGMENTS = [
  { id: "a" as const, label: "A" },
  { id: "b" as const, label: "B" },
];

function layoutIdsIn(html: string): string[] {
  const matches = [...html.matchAll(/data-layout-id="([^"]*)"/g)];
  return matches.map((m) => m[1]!);
}

describe("IosNativeSegment layoutId uniqueness", () => {
  let IosNativeSegment: typeof import("./IosNativeSegment").IosNativeSegment;

  before(async () => {
    ({ IosNativeSegment } = await import("./IosNativeSegment"));
  });

  it("gives two simultaneously-mounted instances DIFFERENT indicator layoutIds", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(IosNativeSegment<View>, {
          value: "a",
          onChange: () => {},
          segments: SEGMENTS,
          "aria-label": "First switcher",
        }),
        React.createElement(IosNativeSegment<View>, {
          value: "b",
          onChange: () => {},
          segments: SEGMENTS,
          "aria-label": "Second switcher",
        })
      )
    );

    const ids = layoutIdsIn(html);
    // Exactly one active indicator per mounted instance (one active tab each).
    assert.equal(ids.length, 2, `expected one indicator per instance, got: ${JSON.stringify(ids)}`);
    assert.ok(ids[0], "first instance must carry a non-empty layoutId");
    assert.ok(ids[1], "second instance must carry a non-empty layoutId");
    assert.notEqual(
      ids[0],
      ids[1],
      "two simultaneously-mounted IosNativeSegment instances must not share a layoutId — " +
        "Framer Motion treats a shared layoutId as ONE logical element and hides one instance's " +
        "active-tab indicator"
    );
  });

  it("still gives a single instance exactly one indicator (the per-instance id didn't break the basic case)", () => {
    const html = renderToStaticMarkup(
      React.createElement(IosNativeSegment<View>, {
        value: "a",
        onChange: () => {},
        segments: SEGMENTS,
        "aria-label": "Switcher",
      })
    );
    const ids = layoutIdsIn(html);
    assert.equal(ids.length, 1);
    assert.ok(ids[0]);
  });
});
