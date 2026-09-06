# 2026-09-06 — Swing Book context silently dropped on v4 collapse

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|---------------------|

## Symptom

`main` verify RED after #4119 brief v4: `play-brief.test.ts` — book concentration reported in 0 sections.

## Root cause

`collapseRedundantIntelSections` dropped **Book context** whenever Trade manager read leads. #4116 had removed duplicate `bookContextCoaching` bullets from narrative, so overlap warnings vanished entirely.

## Fix

Fold **Book context** body into **Trade manager read** when collapsing (once-only invariant preserved).

## RTH check

OPEN NRG/NVDA-style book with theme overlap — **Trade manager read** must mention **Concentration**; no separate **Book context** section when narrative leads.
