> **kind:** FINDING

## `grid-rth-all-day-agent.yml` has been silently failing on every trigger since it was re-enabled — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (tooling/CI — no member-facing impact, but the entire Grid RTH all-day Cursor-agent verify/fix loop has been a no-op) |

### Root cause

`.github/workflows/grid-rth-all-day-agent.yml`'s last step builds a multi-line `PROMPT` shell
variable inside a `run: |` block scalar:

```yaml
          PROMPT="${BOOTSTRAP}

${EXTRA}"
```

The intent is `PROMPT = BOOTSTRAP + "\n\n" + EXTRA` (a blank-line separator between the two
sections of the prompt). But the closing `${EXTRA}"` line sits at **column 0** — no leading
whitespace — while every other line in this `run: |` block is indented 10 spaces. YAML block
scalars end the instant a non-blank line is indented *less* than the block's own established
indentation; a lone blank line doesn't end it, but the next real content does. So YAML terminated
the block scalar right there and tried to parse `${EXTRA}"` (and everything after it, including the
next step's `payload=$(node -e "..."` block) as fresh top-level YAML — which isn't valid, and the
whole file failed to parse.

Confirmed independently with both `js-yaml` (Node) and `PyYAML` (Python) against the exact
committed bytes:

```
YAML PARSE ERROR: can not read a block mapping entry; a multiline key may not be an implicit key (88:21)
yaml.scanner.ScannerError: while scanning a simple key ... could not find expected ':' (88:21)
```

### Why it went unnoticed

This workflow's only triggers are `schedule` and `workflow_dispatch` — **no `push` trigger** — so
a broken file never shows a red ✗ on any PR or commit the way a normal CI workflow would. GitHub
still evaluates the file against every push (to decide whether it's relevant), and when the file
fails to parse it records a `workflow_runs` entry with `conclusion: failure` and **zero jobs** —
but because nothing else in the repo's usual sweep (PR checks, `verify`, CodeQL) references this
workflow, that failure entry is invisible unless someone is specifically looking at
`actions/workflows` runs filtered to this file. Confirmed via the GitHub API: three consecutive
pushes to `main` (the #3440, #3442, and #3439-merge commits) each produced a `grid-rth-all-day-agent.yml`
run with `status: completed`, `conclusion: failure`, `total_jobs: 0`, and no check-run was ever
created (`check_suite.latest_check_runs_count: 0`) — the file was rejected before any job could be
dispatched, on every single trigger since it was "re-enabled 2026-09-03" (per the file's own header
comment). Every scheduled RTH verify/fix cycle and any manual `workflow_dispatch` in that window
silently did nothing.

### Fix

Rewrote the string construction to avoid embedding a literal blank line in the YAML source at all,
so there's no indentation boundary to trip over:

```bash
PROMPT="${BOOTSTRAP}"$'\n\n'"${EXTRA}"
```

Verified byte-for-byte identical output to the original (broken) construction via a direct bash
string comparison (`$'\n\n'` is an ANSI-C-quoted two-newline literal, concatenated between the two
quoted expansions — same runtime value, zero YAML-significant line breaks in the source).

### Regression guard

New test `src/github-workflows-yaml-parse.test.ts`: parses every `.github/workflows/*.yml` file
with `js-yaml` and asserts each parses to an object. Confirmed RED pre-fix (`git stash` on just the
workflow file, keeping the test — fails with the exact scanner error above) and GREEN post-fix.
This catches the general bug class (any workflow file with invalid YAML) in every workflow file
present or future, not just this one instance.

### Blast radius

Checked every other `.github/workflows/*.yml` file for the same block-scalar/embedded-blank-line
pattern — none of the others construct a multi-line variable this way. Isolated to this one file,
but the new test now guards all of them.

### Note

This was found while investigating a user report that CI "still fails" after a separate PR
(#3439's CI fixes) had already landed — this workflow's repeated silent failure is unrelated to
that PR, but is a real, currently-broken check that would show up in any `actions/workflows` sweep
of `main`.
