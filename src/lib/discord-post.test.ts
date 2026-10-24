import assert from "node:assert/strict";
import { test, mock } from "node:test";

// Regression for the missing fetch timeout: cron-staleness-watchdog, helix-discord-digest,
// and darkpool-discord all `await postDiscordWebhook(...)`/`notifyOpsDiscord(...)` (a thin
// wrapper over the same postOnce/postOnceWithFiles) synchronously in their main path. Before
// the fix, fetch() carried no AbortSignal, so an unresponsive Discord endpoint could hang the
// await for as long as the socket stayed open — up to the whole cron route's own maxDuration —
// instead of failing fast into the already-written fallback/logging path.
import { postDiscordWebhook, postDiscordWebhookWithFiles } from "./discord-post";

test("postDiscordWebhook passes a bounded AbortSignal to fetch, not an unbounded await", async () => {
  let capturedSignal: AbortSignal | undefined;
  const fetchMock = mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedSignal = init?.signal ?? undefined;
    return new Response(null, { status: 204 });
  });
  try {
    const ok = await postDiscordWebhook("https://discord.com/api/webhooks/x/y", { content: "hi" }, "test");
    assert.equal(ok, true);
    assert.ok(
      capturedSignal instanceof AbortSignal,
      "fetch must be called with an AbortSignal — without one, an unresponsive endpoint hangs the await indefinitely"
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test("postDiscordWebhookWithFiles passes a bounded AbortSignal to fetch, not an unbounded await", async () => {
  let capturedSignal: AbortSignal | undefined;
  const fetchMock = mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    capturedSignal = init?.signal ?? undefined;
    return new Response(null, { status: 204 });
  });
  try {
    const ok = await postDiscordWebhookWithFiles(
      "https://discord.com/api/webhooks/x/y",
      { content: "hi" },
      [{ filename: "a.png", bytes: new Uint8Array([1, 2, 3]) }],
      "test"
    );
    assert.equal(ok, true);
    assert.ok(
      capturedSignal instanceof AbortSignal,
      "fetch must be called with an AbortSignal — without one, an unresponsive endpoint hangs the await indefinitely"
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test("a timeout abort is handled exactly like any other delivery failure — never throws, falls back", async () => {
  const timeoutError = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
  let calls = 0;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw timeoutError;
  });
  const prevFallback = process.env.DISCORD_FALLBACK_WEBHOOK_URL;
  process.env.DISCORD_FALLBACK_WEBHOOK_URL = "https://discord.com/api/webhooks/fallback/z";
  try {
    const ok = await postDiscordWebhook("https://discord.com/api/webhooks/x/y", { content: "hi" }, "test");
    assert.equal(ok, false, "a timed-out primary AND fallback must resolve to false, never throw");
    assert.equal(calls, 2, "primary then fallback — the existing one-retry contract is unchanged");
  } finally {
    fetchMock.mock.restore();
    if (prevFallback === undefined) delete process.env.DISCORD_FALLBACK_WEBHOOK_URL;
    else process.env.DISCORD_FALLBACK_WEBHOOK_URL = prevFallback;
  }
});
