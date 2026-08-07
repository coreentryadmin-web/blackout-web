/**
 * HYDRATION PROBE — runs BEFORE any page script (live-ui-audit.cjs --init-js).
 *
 * React 18 reports a hydration mismatch in production as a bare "Minified React error #418" with a
 * minified stack and no component identity, so the live error log cannot say WHICH text diverged.
 * This records the two things that actually cause a text mismatch, at the moment they happen:
 *
 *  1. Locale/time formatting WITHOUT an explicit `timeZone`. The server renders in UTC and the
 *     browser in the member's zone, so any such call reaching SSR output mismatches for every
 *     non-UTC member. 31 of the repo's 32 `toLocale*` call sites pass no timeZone.
 *  2. `Date.now()` / `new Date()` read during render. Server time T, client time T+delta — any
 *     value that rounds differently across that delta mismatches.
 *
 * Both are wrapped, not blocked: the page behaves normally and every call is logged with a stack.
 * `hydrated` marks the boundary — calls before it are the ones React reconciles against.
 */
(() => {
  const probe = { hydrated: false, calls: [], counts: {} };
  window.__probe = probe;

  const MAX = 60;
  const record = (kind, detail, opts) => {
    probe.counts[kind] = (probe.counts[kind] || 0) + 1;
    if (probe.calls.length >= MAX || probe.hydrated) return;
    const stack = (new Error().stack || "").split("\n").slice(2, 6).join(" | ").slice(0, 400);
    probe.calls.push({ kind, detail, tz: opts && opts.timeZone ? opts.timeZone : null, stack });
  };

  for (const name of ["toLocaleTimeString", "toLocaleDateString", "toLocaleString"]) {
    const orig = Date.prototype[name];
    Date.prototype[name] = function (locales, options) {
      // Only a MISSING timeZone can diverge between a UTC server and a local browser.
      if (!options || !options.timeZone) record(`Date.${name}:no-timeZone`, name, options);
      return orig.call(this, locales, options);
    };
  }

  const OrigDTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (locales, options) {
    if (!options || !options.timeZone) record("Intl.DateTimeFormat:no-timeZone", "ctor", options);
    return new OrigDTF(locales, options);
  };
  Intl.DateTimeFormat.prototype = OrigDTF.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = OrigDTF.supportedLocalesOf;

  const origNow = Date.now;
  Date.now = function () {
    record("Date.now", "now");
    return origNow.call(Date);
  };

  // React finishes hydrating in a microtask after DOMContentLoaded; a rAF chain past load is a
  // conservative boundary — anything logged before it is inside the reconciliation window.
  const mark = () => requestAnimationFrame(() => requestAnimationFrame(() => { probe.hydrated = true; }));
  if (document.readyState === "complete") mark();
  else window.addEventListener("load", mark);
})();
