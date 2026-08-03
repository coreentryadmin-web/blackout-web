import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendAttributionToUrl,
  captureAttributionFromSearch,
  internalCampaignParams,
  parseUtmFromSearch,
} from "./utm.ts";

describe("parseUtmFromSearch", () => {
  it("parses standard utm params", () => {
    const out = parseUtmFromSearch("?utm_source=x&utm_medium=social&utm_campaign=desk");
    assert.equal(out.utm_source, "x");
    assert.equal(out.utm_medium, "social");
    assert.equal(out.utm_campaign, "desk");
  });
});

describe("appendAttributionToUrl", () => {
  it("appends overrides to relative paths", () => {
    const url = appendAttributionToUrl("/pricing", internalCampaignParams("learn", "what-is-gex"));
    assert.match(url, /utm_source=learn/);
    assert.match(url, /utm_campaign=what-is-gex/);
  });

  it("preserves existing query params", () => {
    const url = appendAttributionToUrl(
      "/sign-up?redirect_url=%2Fupgrade",
      internalCampaignParams("learn", "what-is-gex"),
    );
    assert.match(url, /redirect_url=/);
    assert.match(url, /utm_source=learn/);
  });
});

describe("captureAttributionFromSearch", () => {
  it("stores first-touch utm_source in sessionStorage", () => {
    const store = new Map<string, string>();
    const originalSession = globalThis.sessionStorage;
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://blackouttrades.com" } },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    });
    try {
      captureAttributionFromSearch("?utm_source=x&utm_campaign=desk", "/");
      captureAttributionFromSearch("?utm_source=learn&utm_campaign=other", "/pricing");
      const raw = store.get("bo_attribution_v1");
      assert.ok(raw);
      const parsed = JSON.parse(raw) as { utm_source?: string; utm_campaign?: string };
      assert.equal(parsed.utm_source, "x");
      assert.equal(parsed.utm_campaign, "desk");
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: originalSession,
      });
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
