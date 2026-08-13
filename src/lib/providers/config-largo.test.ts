import { test } from "node:test";
import assert from "node:assert/strict";
import { largoMemberRouteDeadlineMs, largoToolLoopBudgetMs } from "./config";

test("largo route deadline defaults under ALB 120s idle timeout", () => {
  assert.equal(largoMemberRouteDeadlineMs(), 100_000);
  assert.equal(largoToolLoopBudgetMs(), 75_000);
  assert.ok(largoToolLoopBudgetMs() < largoMemberRouteDeadlineMs());
});

test("largo tool-loop budget respects custom route deadline env", () => {
  const prevDeadline = process.env.LARGO_MEMBER_ROUTE_DEADLINE_MS;
  const prevBudget = process.env.LARGO_TOOL_LOOP_BUDGET_MS;
  try {
    process.env.LARGO_MEMBER_ROUTE_DEADLINE_MS = "90000";
    process.env.LARGO_TOOL_LOOP_BUDGET_MS = "80000";
    assert.equal(largoMemberRouteDeadlineMs(), 90_000);
    assert.equal(largoToolLoopBudgetMs(), 70_000);
  } finally {
    if (prevDeadline === undefined) delete process.env.LARGO_MEMBER_ROUTE_DEADLINE_MS;
    else process.env.LARGO_MEMBER_ROUTE_DEADLINE_MS = prevDeadline;
    if (prevBudget === undefined) delete process.env.LARGO_TOOL_LOOP_BUDGET_MS;
    else process.env.LARGO_TOOL_LOOP_BUDGET_MS = prevBudget;
  }
});
