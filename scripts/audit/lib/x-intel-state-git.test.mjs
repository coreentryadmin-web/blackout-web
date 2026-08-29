import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitXIntelStateIfChanged } from "./x-intel-state-git.mjs";

/** Isolated throwaway git repo so this never touches the real repo's history. */
function makeTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "x-intel-state-git-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  mkdirSync(join(dir, "data/x-intel"), { recursive: true });
  writeFileSync(join(dir, "data/x-intel/post-rotation.json"), JSON.stringify({ recent_hooks: [] }));
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

test("commitXIntelStateIfChanged commits a real change under data/x-intel/", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "data/x-intel/post-rotation.json"), JSON.stringify({ recent_hooks: ["a"] }));
    const committed = commitXIntelStateIfChanged({ cwd: dir });
    assert.equal(committed, true);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    assert.equal(status.trim(), "", "working tree should be clean after commit");
    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: dir, encoding: "utf8" });
    assert.equal(log.trim(), "chore(x-intel): auto-commit rotation state");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commitXIntelStateIfChanged is a no-op when nothing changed", () => {
  const dir = makeTempRepo();
  try {
    const committed = commitXIntelStateIfChanged({ cwd: dir });
    assert.equal(committed, false);
    const log = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf8" });
    assert.equal(log.trim().split("\n").length, 1, "no new commit should have been created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commitXIntelStateIfChanged never throws outside a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-intel-state-git-nogit-"));
  try {
    mkdirSync(join(dir, "data/x-intel"), { recursive: true });
    writeFileSync(join(dir, "data/x-intel/post-rotation.json"), "{}");
    assert.doesNotThrow(() => commitXIntelStateIfChanged({ cwd: dir }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("commitXIntelStateIfChanged ignores changes outside data/x-intel/", () => {
  const dir = makeTempRepo();
  try {
    writeFileSync(join(dir, "unrelated.txt"), "noise");
    const committed = commitXIntelStateIfChanged({ cwd: dir });
    assert.equal(committed, false);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    assert.equal(status.trim(), "?? unrelated.txt", "unrelated file must stay untouched/uncommitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
