import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createVectorEventSource } from "./api.ts";

/**
 * Regression coverage for the Compare-mode SSE bug (2026-08-27): `createVectorEventSource` used to
 * keep a MODULE-LEVEL singleton (`activeVectorStream`/`activeVectorStreamTicker`) and force-close
 * whichever stream it last tracked whenever a call arrived for a different ticker. That's correct
 * for one concurrent caller (the single-pane desk switching ticker) but wrong for Compare mode,
 * which mounts up to 4 independent `VectorChart` instances that each call this with their OWN
 * ticker — pane 2 mounting closed pane 1's live stream, pane 3 closed pane 2's, and so on, leaving
 * only the last-mounted pane live. These tests pin the fix: two concurrent calls for different
 * tickers must each get their own independent connection, and closing one must never close the
 * other.
 */

type Listener = (...args: unknown[]) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onopen: Listener | null = null;
  onmessage: Listener | null = null;
  onerror: Listener | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

function withFakeBrowserGlobals<T>(run: () => T): T {
  const originalWindow = globalThis.window;
  const originalEventSource = globalThis.EventSource;
  FakeEventSource.instances = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FakeEventSource });
  try {
    return run();
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "EventSource", { configurable: true, value: originalEventSource });
  }
}

describe("createVectorEventSource — no cross-instance singleton (Compare-mode regression)", () => {
  it("opening a stream for ticker B does not close an already-open stream for ticker A", () => {
    withFakeBrowserGlobals(() => {
      const streamA = createVectorEventSource("SPX", () => {});
      assert.ok(streamA);
      const [esA] = FakeEventSource.instances;
      assert.equal(esA!.closed, false);

      const streamB = createVectorEventSource("AAPL", () => {});
      assert.ok(streamB);

      // The bug: opening B used to force-close A's underlying EventSource via the module-level
      // singleton. It must still be open.
      assert.equal(esA!.closed, false, "opening a second ticker's stream must not close the first");
    });
  });

  it("four concurrent panes (Compare mode's max) all stay independently open", () => {
    withFakeBrowserGlobals(() => {
      const tickers = ["NVDA", "AAPL", "MSFT", "AMZN"];
      const streams = tickers.map((t) => createVectorEventSource(t, () => {}));
      assert.ok(streams.every(Boolean));
      assert.equal(FakeEventSource.instances.length, 4);
      assert.ok(
        FakeEventSource.instances.every((es) => !es.closed),
        "every pane's stream must remain open once all 4 have connected"
      );
    });
  });

  it("closing one pane's stream does not close a sibling pane's stream", () => {
    withFakeBrowserGlobals(() => {
      const streamA = createVectorEventSource("SPX", () => {});
      const streamB = createVectorEventSource("AAPL", () => {});
      assert.ok(streamA && streamB);
      const [esA, esB] = FakeEventSource.instances;

      streamA!.close();
      assert.equal(esA!.closed, true);
      assert.equal(esB!.closed, false, "closing pane A must not close pane B");
    });
  });

  it("re-opening the SAME ticker still gets its own independent connection", () => {
    withFakeBrowserGlobals(() => {
      const first = createVectorEventSource("SPX", () => {});
      const second = createVectorEventSource("SPX", () => {});
      assert.ok(first && second);
      assert.equal(FakeEventSource.instances.length, 2);
      const [esFirst, esSecond] = FakeEventSource.instances;
      assert.equal(esFirst!.closed, false);
      assert.equal(esSecond!.closed, false);
    });
  });
});
