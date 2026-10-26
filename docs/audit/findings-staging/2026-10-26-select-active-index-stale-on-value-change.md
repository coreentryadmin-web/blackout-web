## Shared `<Select>` dropdown's keyboard cursor never resynced to a `value` prop change, so Enter could silently commit a stale option

> **kind:** `FINDING`

### Root cause

`src/components/ui/Select.tsx` is a controlled dropdown — the caller owns `value` and the
component tracks an internal `active` index (the keyboard/hover highlight, used by
`aria-activedescendant` and by `commit(active)` on Enter). `active` was seeded ONCE from
`value` via a lazy `useState` initializer at mount:

```ts
const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
```

but nothing ever re-ran that computation afterward. If the caller changes `value` from
outside the component — the normal mode for a controlled component, e.g. resetting a filter
or syncing from a parent's own state — `active` keeps pointing at whichever option was
selected at mount. The selected-option highlight itself (`isSel = opt.value === value`) stays
correct because it reads `value` directly, so visually the dropdown looks fine when closed.
The defect only surfaces on the keyboard path: opening the menu with a click (or `Enter`/
`ArrowDown` while closed, neither of which resyncs `active` either) and then pressing `Enter`
calls `commit(active)`, which calls `onChange(options[active].value)` — silently re-selecting
whatever option was active at mount, not the option `value` currently names, with no visual
cue that anything happened differently from "confirm the current selection."

### Evidence

No DOM-rendering test harness exists in this repo (no `jsdom`/`@testing-library/react` in
`package.json`), so per this repo's established convention for logic embedded in client
components (e.g. `effectiveFreshnessStatus` in `FreshnessChip.tsx`), the index computation is
extracted into an exported pure function, `resolveSelectActiveIndex(options, value)`, used by
both the initial state and a new resync effect. `Select.test.tsx` (3 new tests) confirmed RED
before the fix (`git stash` isolating `Select.tsx` — the helper doesn't exist yet, all 3 fail
with `is not a function`) and GREEN after (3/3 pass). `tsc --noEmit` clean.

**Disclosed scope note:** grepping the whole repo for `ui/Select` and `SelectOption` finds
**no live caller** of this component today — `VectorAlertsBell.tsx`'s only reference is a code
comment pointing at `Select.tsx`'s click-outside pattern as something it independently
re-implemented, not an import. This is a latent defect in a shared design-system primitive
that is exported from `src/components/ui/index.ts` for future use, not one currently visible
on any live page. Fixed now rather than left for whichever desk adopts it first, per the
standing policy of fixing a real, confirmed defect as soon as it's spotted.

### Blast radius

Single file (`Select.tsx`) — the one component affected. No current callers, so no live page
behavior changes. Future callers get the correct resync for free.

### Fix rationale

Add a `useEffect` keyed on `[value, options]` that re-derives `active` via the same resolver
the initial state uses, bailing out via a functional `setActive` update when the index hasn't
actually changed (avoids an unnecessary re-render when `options`' identity churns without its
contents changing, the same guard pattern already used in this file's `commit`/`onKey`
handlers' call sites and in `Tabs.tsx`'s `TabList` rail-indicator `measure()`). No other
behavior changed — initial mount, open/close, and keyboard navigation while open are untouched.

| **Status** | Fixed in PR #TBD (branch `fix/select-active-index-stale-on-value-change`) |
|---|---|
