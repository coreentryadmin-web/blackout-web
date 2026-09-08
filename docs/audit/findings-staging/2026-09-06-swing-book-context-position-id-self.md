# Swing book context false-flags reviewed play as concentration — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-swings-book-self |
| **Severity** | P2 |
| **Area** | Night Hawk Swings / Largo play-brief |
| **Status** | FIXED in PR (pending merge) |

## Symptom

When two independent open swing positions share the same ticker+direction (allowed by `swingThesisKey(ticker, direction, archetype)`), the "Book context" section could report **concentration against the reviewed play itself** if that position was not the first matching row in `openBook`.

## Root cause

`checkPortfolioOverlap` excluded only the **first** row matching ticker+direction as "self." `loadOpenBook()` passed rows without ledger ids, so the overlap checker could not identify which row was the play under review (`SWING:EWZ:26`).

## Fix

- `PortfolioPosition` carries optional `positionId`
- `loadOpenBook()` stamps `positionId: r.id`
- `bookContextSection` parses `play.id` and passes `excludePositionId`
- Gate callers unchanged (`excludeSelfMatch: false` for uncommitted dossiers)

## Evidence

Regression tests in `portfolio.test.ts` and `play-brief-intel.test.ts` — RED before fix (second EWZ LONG row counted as overlap against itself when reviewing position 26).

## RTH validation

On a ticker with two open same-direction swing legs, open Ask Largo for the **second** leg — Book context should cite only the **other** leg, never duplicate the reviewed ticker as concentration.
