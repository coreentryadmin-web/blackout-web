// src/lib/swing/roll.test.ts — PR-15. Unit-tests the PURE roll-transition logic with INJECTED accessors
// (no live DB). Asserts the four load-bearing properties from the spec:
//   • parent grade FROZEN on roll (terminal ROLLED, realized_pnl_pct pinned once; the child write is a
//     separate row and can't mutate it);
//   • child links parent_position_id + root_position_id (sticky root) correctly and roll_seq increments;
//   • a snapshot is appended even when nothing gates (the SKIP path);
//   • a broken-thesis intent VETOES the roll → CLOSE-not-roll (the close path, never the child insert);
//   • the whole roll is transactional — a child-insert failure aborts with the parent NOT half-closed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  closeAndRollSwingPosition,
  decideRollAction,
  type ParentGradeFreeze,
  type RollChildSpec,
  type RollLedgerDeps,
  type RollParentLike,
} from "./roll";
import type { SwingManageVerdict } from "./manage";
import type { SwingPositionInsert, SwingSnapshotInsert } from "../db";

// ─── fakes ───────────────────────────────────────────────────────────────────

type GradeCall = { id: number; g: ParentGradeFreeze & { status: "CLOSED" | "ROLLED" } };

function fakeLedger(opts?: { failChildInsert?: boolean; failGrade?: boolean }) {
  const gradeCalls: GradeCall[] = [];
  const childInserts: SwingPositionInsert[] = [];
  const snapshots: SwingSnapshotInsert[] = [];
  let nextChildId = 900;
  let nextSnapId = 500;
  const deps: RollLedgerDeps = {
    async gradeParent(id, g) {
      if (opts?.failGrade) throw new Error("grade boom");
      gradeCalls.push({ id, g });
    },
    async insertChild(pos) {
      if (opts?.failChildInsert) throw new Error("child insert boom");
      childInserts.push(pos);
      return (nextChildId += 1);
    },
    async insertSnapshot(s) {
      snapshots.push(s);
      return (nextSnapId += 1);
    },
  };
  return { deps, gradeCalls, childInserts, snapshots };
}

function verdict(over: Partial<SwingManageVerdict>): SwingManageVerdict {
  return {
    action: "EXIT",
    rung: "expiry_risk",
    enforced: true,
    reason: "test verdict",
    dteMigration: { migrate: true, reason: "low dte" },
    rollIntent: { roll: true, reason: "still-valid thesis at low DTE" },
    ...over,
  };
}

const parent = (over?: Partial<RollParentLike>): RollParentLike => ({
  id: 42,
  root_position_id: null,
  roll_seq: 0,
  ...over,
});

const grade: ParentGradeFreeze = {
  grade_json: { thesis: "CONFIRMED" },
  grade_methodology: "swing-multitruth-v1",
  realized_pnl_pct: -18.5, // a LOSING parent leg — the roll must preserve this, never net it away.
};

const childSpec: RollChildSpec = {
  commit_key: "SWING:NVDA:long:2026-08-15:roll1",
  session_date: "2026-07-24",
  ticker: "NVDA",
  direction: "long",
  sub_lane: "STANDARD",
  contract_strike: 130,
  contract_expiry: "2026-08-15",
  contract_type: "call",
  entry_premium: 4.2,
};

const snap: SwingSnapshotInsert = { position_id: 42, snapshot_kind: "roll" };

// ─── decideRollAction (pure) ───────────────────────────────────────────────────

test("decideRollAction: gating rung + valid-thesis roll intent → ROLL", () => {
  const d = decideRollAction(verdict({ rung: "expiry_risk", rollIntent: { roll: true, reason: "r" } }));
  assert.equal(d.action, "ROLL");
});

test("decideRollAction: gating rung + vetoed roll (broken thesis) → CLOSE, not roll", () => {
  const d = decideRollAction(verdict({ rung: "structural_stop", rollIntent: { roll: false, reason: "thesis broken — close, do not roll" } }));
  assert.equal(d.action, "CLOSE");
});

test("decideRollAction: edge rung → SKIP (gating-only; evidence-only rungs never write terminal)", () => {
  for (const rung of ["flow_decay", "profit_ladder", "hold", "insufficient_data"] as const) {
    const d = decideRollAction(verdict({ rung, rollIntent: { roll: false, reason: "n/a" } }));
    assert.equal(d.action, "SKIP", `rung ${rung} must SKIP`);
  }
});

// ─── ROLL: close+grade+link, parent frozen, child linked ───────────────────────

test("ROLL: freezes parent as terminal ROLLED with realized pinned, inserts linked child, appends snapshot", async () => {
  const { deps, gradeCalls, childInserts, snapshots } = fakeLedger();
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent({ id: 42, root_position_id: null, roll_seq: 0 }),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });

  assert.equal(out.action, "ROLL");
  assert.equal(out.error, undefined);
  assert.equal(out.parentGraded, true);
  assert.equal(out.childId != null, true);
  assert.equal(out.snapshotId != null, true);

  // Parent frozen exactly once as ROLLED with the (losing) realized pinned — never netted away.
  assert.equal(gradeCalls.length, 1);
  assert.equal(gradeCalls[0]!.id, 42);
  assert.equal(gradeCalls[0]!.g.status, "ROLLED");
  assert.equal(gradeCalls[0]!.g.realized_pnl_pct, -18.5);

  // Child linked: parent_position_id = parent.id; root sticky (parent.root ?? parent.id) = 42; roll_seq +1.
  assert.equal(childInserts.length, 1);
  assert.equal(childInserts[0]!.parent_position_id, 42);
  assert.equal(childInserts[0]!.root_position_id, 42);
  assert.equal(childInserts[0]!.roll_seq, 1);
  assert.equal(childInserts[0]!.ticker, "NVDA");

  // Snapshot appended on the roll tick.
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]!.snapshot_kind, "roll");
});

test("ROLL: root_position_id stays the chain root on a 2nd-generation roll (not the parent id)", async () => {
  const { deps, childInserts } = fakeLedger();
  // Parent is itself a rolled leg: id 77, root 10, roll_seq 1 → child must keep root 10, roll_seq 2.
  await closeAndRollSwingPosition(deps, {
    parent: parent({ id: 77, root_position_id: 10, roll_seq: 1 }),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });
  assert.equal(childInserts[0]!.parent_position_id, 77);
  assert.equal(childInserts[0]!.root_position_id, 10);
  assert.equal(childInserts[0]!.roll_seq, 2);
});

test("ROLL: a later child write cannot mutate the frozen parent grade (separate rows; parent graded once)", async () => {
  const { deps, gradeCalls, childInserts } = fakeLedger();
  await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });
  // Only ONE grade write (the parent). The child is an INSERT of a different row and carries no path to the
  // parent's realized_pnl_pct — the frozen loss survives the roll.
  assert.equal(gradeCalls.length, 1);
  assert.equal(childInserts.length, 1);
  assert.equal("realized_pnl_pct" in childInserts[0]!, false);
});

// ─── CLOSE: broken-thesis veto is a close, not a roll ──────────────────────────

test("CLOSE (broken thesis): grades parent CLOSED, NEVER inserts a child", async () => {
  const { deps, gradeCalls, childInserts, snapshots } = fakeLedger();
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rung: "structural_stop", rollIntent: { roll: false, reason: "structural stop hit — close, do not roll" } }),
    parentGrade: grade,
    childSpec, // present, but a CLOSE must ignore it
    snapshot: snap,
  });

  assert.equal(out.action, "CLOSE");
  assert.equal(out.error, undefined);
  assert.equal(out.parentGraded, true);
  assert.equal(out.childId, null);
  // Parent terminated as CLOSED (not ROLLED); NO child leg opened — the veto is an exit.
  assert.equal(gradeCalls.length, 1);
  assert.equal(gradeCalls[0]!.g.status, "CLOSED");
  assert.equal(childInserts.length, 0);
  // The management snapshot is still appended on the close tick.
  assert.equal(snapshots.length, 1);
});

test("CLOSE (thesis_stop rung): also closes, no child", async () => {
  const { deps, gradeCalls, childInserts } = fakeLedger();
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rung: "thesis_stop", rollIntent: { roll: false, reason: "archetype invalidation" } }),
    parentGrade: grade,
    snapshot: snap,
  });
  assert.equal(out.action, "CLOSE");
  assert.equal(gradeCalls[0]!.g.status, "CLOSED");
  assert.equal(childInserts.length, 0);
});

// ─── SKIP: edge/hold rungs are evidence-only, snapshot still appended ───────────

test("SKIP: nothing gates → NO terminal write, but the snapshot is still appended", async () => {
  const { deps, gradeCalls, childInserts, snapshots } = fakeLedger();
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rung: "flow_decay", action: "TAKE_PARTIAL", enforced: false, rollIntent: { roll: false, reason: "n/a" } }),
    parentGrade: grade,
    snapshot: snap,
  });
  assert.equal(out.action, "SKIP");
  assert.equal(out.parentGraded, false);
  assert.equal(out.childId, null);
  assert.equal(out.snapshotId != null, true);
  // Evidence-only: neither the parent nor a child was written.
  assert.equal(gradeCalls.length, 0);
  assert.equal(childInserts.length, 0);
  assert.equal(snapshots.length, 1);
});

// ─── transactional / all-or-nothing ────────────────────────────────────────────

test("TRANSACTIONAL: a child-insert failure aborts BEFORE the parent flip — parent is NOT half-closed", async () => {
  const { deps, gradeCalls, snapshots } = fakeLedger({ failChildInsert: true });
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });
  assert.equal(out.action, "ROLL");
  assert.match(out.error ?? "", /child insert boom/);
  // The parent's terminal ROLLED flip is ordered AFTER the child write, so a child failure never reaches it:
  // the parent stays fully OPEN (not half-closed), and no snapshot is appended for the aborted roll.
  assert.equal(out.parentGraded, false);
  assert.equal(out.childId, null);
  assert.equal(gradeCalls.length, 0);
  assert.equal(snapshots.length, 0);
});

test("TRANSACTIONAL: a grade failure after the child insert is caught fail-soft (never thrown)", async () => {
  const { deps, childInserts } = fakeLedger({ failGrade: true });
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });
  assert.match(out.error ?? "", /grade boom/);
  assert.equal(out.parentGraded, false);
  // The child was written (idempotent on commit_key); the parent-grade retry is safe (graded_at IS NULL guard).
  assert.equal(childInserts.length, 1);
});

// ─── SEV-3: atomic roll through the runRollTx seam (child-insert + parent-grade in ONE tx) ──────

// A fake that emulates db.ts `withSwingRollTx`: it stages the child insert + parent grade and only
// "commits" them if the callback resolves; if the callback throws (e.g. the parent grade reports 0
// rows — a grade race) it discards BOTH staged writes and rethrows, exactly like a ROLLBACK. The base
// (non-tx) gradeParent/insertChild MUST NOT be reached on this path — the terminal writes go through
// the tx seam.
function fakeTxLedger(opts?: { gradeRowcount?: number }) {
  const gradeCalls: GradeCall[] = [];
  const committedChildren: SwingPositionInsert[] = [];
  const snapshots: SwingSnapshotInsert[] = [];
  let nextChildId = 900;
  let nextSnapId = 500;
  const deps: RollLedgerDeps = {
    async gradeParent() {
      throw new Error("base gradeParent must not run when runRollTx is present (terminal write must be atomic)");
    },
    async insertChild() {
      throw new Error("base insertChild must not run when runRollTx is present (terminal write must be atomic)");
    },
    async insertSnapshot(s) {
      snapshots.push(s);
      return (nextSnapId += 1);
    },
    async runRollTx(fn) {
      const stagedChildren: SwingPositionInsert[] = [];
      const stagedGrades: GradeCall[] = [];
      const tx = {
        async insertChild(pos: SwingPositionInsert) {
          stagedChildren.push(pos);
          return (nextChildId += 1);
        },
        async gradeParent(id: number, g: GradeCall["g"]) {
          const rc = opts?.gradeRowcount ?? 1;
          if (rc === 0) {
            // Mirror withSwingRollTx's 0-row guard: a terminal flip that matched nothing is a grade race.
            throw new Error(`swing roll: parent grade affected 0 rows (position ${id} already graded/terminal — grade race); rolling back`);
          }
          stagedGrades.push({ id, g });
          return rc;
        },
      };
      // COMMIT only if the callback resolves; otherwise ROLLBACK (discard staged writes) and rethrow.
      const res = await fn(tx);
      committedChildren.push(...stagedChildren);
      gradeCalls.push(...stagedGrades);
      return res;
    },
  };
  return { deps, gradeCalls, committedChildren, snapshots };
}

test("ATOMIC ROLL: with runRollTx, child insert + parent grade commit together through the tx seam (base accessors untouched)", async () => {
  const { deps, gradeCalls, committedChildren, snapshots } = fakeTxLedger();
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent({ id: 42, root_position_id: null, roll_seq: 0 }),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });
  assert.equal(out.action, "ROLL");
  assert.equal(out.error, undefined);
  assert.equal(out.parentGraded, true);
  assert.equal(out.childId != null, true);
  // Both terminal writes committed atomically; the child links off the parent; parent frozen ROLLED.
  assert.equal(committedChildren.length, 1);
  assert.equal(committedChildren[0]!.root_position_id, 42);
  assert.equal(committedChildren[0]!.roll_seq, 1);
  assert.equal(gradeCalls.length, 1);
  assert.equal(gradeCalls[0]!.g.status, "ROLLED");
  // Snapshot appended after the atomic close.
  assert.equal(snapshots.length, 1);
});

test("ATOMIC ROLL (grade race): a 0-row parent-grade flip ROLLS BACK the child — parent left OPEN, no orphan, no snapshot", async () => {
  const { deps, gradeCalls, committedChildren, snapshots } = fakeTxLedger({ gradeRowcount: 0 });
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    childSpec,
    snapshot: snap,
  });
  assert.equal(out.action, "ROLL");
  // The 0-row terminal flip is an ERROR, not a silent success — the whole roll aborts.
  assert.match(out.error ?? "", /0 rows/);
  assert.equal(out.parentGraded, false);
  assert.equal(out.childId, null);
  // Nothing committed: the staged child was rolled back with the failed grade — no orphan child on an OPEN parent.
  assert.equal(committedChildren.length, 0);
  assert.equal(gradeCalls.length, 0);
  // No snapshot for the aborted roll (append happens only after a successful close).
  assert.equal(snapshots.length, 0);
});

test("ATOMIC CLOSE: a broken-thesis close also routes its single grade through the tx seam (0-row guard applies)", async () => {
  const { deps, gradeCalls, committedChildren } = fakeTxLedger({ gradeRowcount: 0 });
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rung: "structural_stop", rollIntent: { roll: false, reason: "thesis broken — close" } }),
    parentGrade: grade,
    snapshot: snap,
  });
  assert.equal(out.action, "CLOSE");
  assert.match(out.error ?? "", /0 rows/);
  assert.equal(out.parentGraded, false);
  assert.equal(gradeCalls.length, 0);
  assert.equal(committedChildren.length, 0);
});

test("ROLL with no childSpec: refuses and leaves the parent OPEN (no grade write)", async () => {
  const { deps, gradeCalls, childInserts } = fakeLedger();
  const out = await closeAndRollSwingPosition(deps, {
    parent: parent(),
    verdict: verdict({ rollIntent: { roll: true, reason: "roll" } }),
    parentGrade: grade,
    // childSpec deliberately omitted
    snapshot: snap,
  });
  assert.equal(out.action, "ROLL");
  assert.match(out.error ?? "", /requires a childSpec/);
  assert.equal(out.parentGraded, false);
  assert.equal(gradeCalls.length, 0);
  assert.equal(childInserts.length, 0);
});
