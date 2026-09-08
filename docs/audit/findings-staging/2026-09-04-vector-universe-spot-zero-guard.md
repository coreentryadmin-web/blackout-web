# 2026-09-04 — vector-universe GEX walls: zero spot passed to computeGexWalls

> **kind:** FINDING

| Field | Detail |
|---|---|
| **Symptom** | When `hm.spot` is `0` (transient chain miss), `spot ?? undefined` passed literal `0` into `computeGexWalls`, applying a bogus side-constraint and persisting wrong-side walls into narrowed-horizon history. |
| **Root cause** | Main blended `gexWalls` path still used `spot ?? undefined` while narrowed-horizon path was partially fixed on `cursor/platform-bug-sweep` — inconsistent guards. |
| **Fix** | Both `computeGexWalls` call sites use `spot != null && spot > 0 ? spot : undefined`. |
| **Status** | FIXED |
