import { test } from "node:test";
import assert from "node:assert/strict";
import { isClerkErrorClassName, isBenignClerkAuthMessage, shouldReportAuthFailure, DEDUPE_WINDOW_MS } from "./auth-failure-detect";

test("isClerkErrorClassName: matches Clerk's formFieldErrorText marker", () => {
  assert.equal(isClerkErrorClassName("cl-formFieldErrorText cl-formFieldErrorText__password abc123"), true);
});

test("isClerkErrorClassName: matches Clerk's alert marker", () => {
  assert.equal(isClerkErrorClassName("cl-alert cl-alert__error"), true);
});

test("isClerkErrorClassName: does not match an unrelated element", () => {
  assert.equal(isClerkErrorClassName("cl-formFieldInput cl-formFieldInput__password"), false);
});

test("isClerkErrorClassName: empty className never matches", () => {
  assert.equal(isClerkErrorClassName(""), false);
});

test("isBenignClerkAuthMessage: already-signed-in navigation is not a failed attempt", () => {
  assert.equal(isBenignClerkAuthMessage("You're already signed in"), true);
  assert.equal(isBenignClerkAuthMessage("You are already signed in"), true);
});

test("isBenignClerkAuthMessage: one-time sign-in ticket reuse is audit harness noise", () => {
  assert.equal(
    isBenignClerkAuthMessage("This sign in token has already been used. Each token can only be used once."),
    true
  );
});

test("isBenignClerkAuthMessage: real credential failures are not benign", () => {
  assert.equal(isBenignClerkAuthMessage("Password is incorrect"), false);
  assert.equal(isBenignClerkAuthMessage("Too many requests"), false);
});

test("shouldReportAuthFailure: benign Clerk messages never report", () => {
  assert.equal(shouldReportAuthFailure("You're already signed in", null, 1000), false);
});

test("shouldReportAuthFailure: first-ever message always reports", () => {
  assert.equal(shouldReportAuthFailure("Password is incorrect", null, 1000), true);
});

test("shouldReportAuthFailure: blank/whitespace-only message never reports", () => {
  assert.equal(shouldReportAuthFailure("   ", null, 1000), false);
  assert.equal(shouldReportAuthFailure("", { message: "x", at: 0 }, 1000), false);
});

test("shouldReportAuthFailure: identical message within the dedupe window is suppressed", () => {
  const last = { message: "Password is incorrect", at: 1000 };
  assert.equal(shouldReportAuthFailure("Password is incorrect", last, 1000 + DEDUPE_WINDOW_MS - 1), false);
});

test("shouldReportAuthFailure: identical message AFTER the dedupe window reports again", () => {
  const last = { message: "Password is incorrect", at: 1000 };
  assert.equal(shouldReportAuthFailure("Password is incorrect", last, 1000 + DEDUPE_WINDOW_MS + 1), true);
});

test("shouldReportAuthFailure: a DIFFERENT message reports immediately, even inside the window", () => {
  const last = { message: "Password is incorrect", at: 1000 };
  assert.equal(shouldReportAuthFailure("Too many requests", last, 1001), true);
});

test("shouldReportAuthFailure: future lastReported.at beyond tolerance does not dedupe forever", () => {
  const last = { message: "Password is incorrect", at: 20_000 };
  assert.equal(shouldReportAuthFailure("Password is incorrect", last, 1000), true);
});
