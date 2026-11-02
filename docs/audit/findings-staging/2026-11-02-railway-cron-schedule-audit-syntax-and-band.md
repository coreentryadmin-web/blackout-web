> **kind:** FINDING

## `scripts/railway-cron-schedule-audit.mjs` — crashed on every run, and mislabeled weekday ranges as hour bands — FIXED

**Status:** FIXED (this PR)

### Root cause

Two independent, compounding bugs in this standalone human-readable cron-schedule audit tool
(`node scripts/railway-cron-schedule-audit.mjs`), both present on `main` before this fix:

1. **Crash on every invocation.** The file ended with a stray bare `PY` token on its own line
   (line 53) — almost certainly a leaked heredoc delimiter (`cat <<'PY' ... PY`) from whatever
   shell command originally authored the file, where the closing `PY` marker ended up written
   *into* the file instead of being consumed by the shell. As committed, `PY` is parsed as a
   top-level expression statement referencing an undefined identifier, so the script throws
   `ReferenceError: PY is not defined` and exits 1 on every run — *after* it has already printed
   all of its real output, so the crash is easy to miss by eye but makes the tool useless as a
   CI gate or for anything that checks the exit code.

2. **Wrong UTC/ET band computed for any cron whose HOUR field is a comma-list.** `utcBandToEt()`
   ran one unanchored regex over the *entire* cron string looking for the first
   `"<token> <num>-<num>"` substring anywhere in it, rather than reading the hour field (field
   index 1 of the 5-field cron spec) by position. For a cron like `banger-discovery`'s real
   schedule `15 20,21 * * 1-5`, the hour field `20,21` is a comma-list, not a dash-range, so it
   contains no `-`. The regex kept scanning rightward and matched the *trailing weekday field*
   `1-5` (Monday–Friday) instead, and the script printed `1:00–5:59 UTC` / `-3:00–1:59 ET (EDT)`
   as if that were the cron's firing-hour window — when `1-5` actually means "Monday through
   Friday", not "1 AM–5 AM". This silently mislabeled the UTC/ET band for every comma-list-hour
   cron in this repo's `railway.*.toml` files: `banger-discovery`, `GEX-EOD-Snapshot`,
   `Largo-Morning-Brief`, `nighthawk-backfill-repair`, `NightHawk-Morning-Confirm`,
   `NightHawk-Outcomes-Cron`, `SPX-Signal-Weight-Optimize` (bare single-hour field, no dash at
   all — also wrongly matched the weekday range), `Swing-Discovery`, and `zerodte-skip-grade` —
   nine real production cron schedules, exactly the class of ET/UTC-alignment question this
   tool exists to answer correctly (see CLAUDE.md's `cron-dst-audit.mjs` entry on how silently
   wrong ET scheduling has caused real production incidents in this repo, e.g. `x-autopost` and
   `banger-discovery` itself in 2026-08-21).

### Evidence

Before the fix, running the script on `origin/main` throws after printing all rows:

```
$ node scripts/railway-cron-schedule-audit.mjs
... (all rows print correctly) ...
file:///…/scripts/railway-cron-schedule-audit.mjs:53
PY
^
ReferenceError: PY is not defined
Node.js v20.20.2
```
Exit code 1.

And for `banger-discovery` (`cronSchedule = "15 20,21 * * 1-5"`), the printed band was:
```
banger-discovery
  cron: 15 20,21 * * 1-5
  → 1:00–5:59 UTC
  → -3:00–1:59 ET (EDT, Mar–Nov)  (app skips outside 9:30–16:00 ET)
  → -4:00–0:59 ET (EST, Nov–Mar)
```
"1:00–5:59 UTC" is the cron's **weekday range** (`1-5` = Mon–Fri) misread as an hour-of-day
window — the real schedule fires at :15 past the hour during UTC hours 20 and 21 only.

A new regression test suite (`scripts/railway-cron-schedule-audit-lib.test.mjs`, 5 cases)
reproduces bug #2 directly against the extracted pure function: reverting the fix (restoring
the original unanchored regex) makes 3/5 cases fail with exactly this `1:00–5:59 UTC` fabricated
output; the fixed version returns `null` (no fabricated band) for every comma-list/no-range hour
field, while still correctly computing the band for genuine dash-range hour fields (verified
`git stash`-style before/after in this PR's own development, not just asserted).

### Blast radius

Single file + its one caller. `utcBandToEt()` had exactly one call site
(`scripts/railway-cron-schedule-audit.mjs`'s own row-building loop) — no other script imports it.
`CRON_SERVICE_NAMES`/`railway-cron-services.mjs` (the sibling registry this script also reads)
was already fixed separately in #7355 and is untouched here. This script is not wired into
`package.json` or any CI workflow — it is a standalone manual ops tool a human or agent runs
directly — so the crash never failed a CI gate, but it does mean every manual invocation ended
in a stack trace, and the wrong band output (bug #2) would mislead anyone using this tool to
reason about whether a cron's firing window still lines up with RTH across the EDT/EST
transition (exactly the question `cron-dst-audit.mjs`'s own incident history in CLAUDE.md shows
getting silently wrong has caused real production misfires).

### Fix rationale

- Removed the stray `PY` line — nothing else needed; it was dead/unreachable only in the sense
  that it ran after all useful work, but it still corrupted the exit code and the stack trace.
- Extracted `utcBandToEt` into a sibling pure module (`railway-cron-schedule-audit-lib.mjs`) so
  it can be unit-tested with the plain node test runner (the audit script itself has module-scope
  filesystem side effects, same pattern already used elsewhere in `scripts/` per CLAUDE.md's CI
  lessons).
- Rewrote the function to split the cron string into its 5 whitespace-separated fields and test
  **only** `fields[1]` (the hour field) for a literal `^\d{1,2}-\d{1,2}$` dash-range, rather than
  scanning the whole string with one unanchored regex. A comma-list, a step (`*/N`), or a bare
  wildcard hour field has no single continuous UTC window to report, so the fixed function
  correctly returns `null` for those instead of fabricating one from an unrelated field — this is
  a deliberate behavior change (fewer printed bands) but trades a confidently-wrong number for an
  honestly-absent one, consistent with this repo's general "omission is honest; fabrication is
  not" principle (see CLAUDE.md's Largo product contract, same discipline applied here to a
  different kind of absence).
- Left alone: the regex that extracts `cronSchedule = "..."` from each TOML (unaffected, already
  field-agnostic), and the RTH-gate explanatory banner text (unaffected, describes the app's own
  in-route gate, not this function's output).
