# Swing desk consensus narrative dedup — FIXED

> **kind:** FINDING

## Problem

`deskConsensusSection` duplicated cross-desk direction reads already narrated by `crossDeskCoaching` in the Trade manager read (bullet-dump NH direction + 0DTE score vs coaching-voice friction/alignment). Largo mandate gap: "narrating cross-desk disagreement instead of listing it."

## Fix

- Removed raw NH direction / 0DTE stance lines from `deskConsensusSection` (owned by `crossDeskCoaching`).
- Retained supplementary context only: NH outcome history + flow anomaly coaching.
- Renamed section title to "Desk context" to reflect supplementary role.

| **Status** | FIXED — 3 regression tests added |
