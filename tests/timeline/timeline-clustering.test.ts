import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runGit } from "@gitwhisper/git";
import {
  getCommitTimeline,
  extractTimelineCommits,
  clusterCommitsIntoWorkstreams,
} from "@gitwhisper/core";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

describe("Phase 14 — Commit Timeline & History Intelligence (@gitwhisper/core)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-timeline-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("handles empty repository with 0 commits gracefully", async () => {
    const timeline = await getCommitTimeline(repo.path);
    expect(timeline.commits).toHaveLength(0);
    expect(timeline.workstreams).toHaveLength(0);
    expect(timeline.summary.totalCommits).toBe(0);
  });

  it("clusters commits by conventional scope and shared files", async () => {
    // Commit 1: auth
    await repo.writeFile("src/auth/login.ts", "export const login = () => true;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(auth): implement login endpoint"], { cwd: repo.path });

    // Commit 2: billing
    await repo.writeFile("src/billing/invoice.ts", "export const invoice = () => true;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(billing): create invoice generator"], { cwd: repo.path });

    // Commit 3: auth follow-up
    await repo.writeFile("src/auth/session.ts", "export const session = () => true;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "fix(auth): handle session expiration"], { cwd: repo.path });

    const timeline = await getCommitTimeline(repo.path);
    expect(timeline.commits).toHaveLength(3);
    expect(timeline.workstreams.length).toBeGreaterThanOrEqual(2);

    const authWs = timeline.workstreams.find(
      (w) => w.scope === "auth" || w.name.toLowerCase().includes("auth"),
    );
    expect(authWs).toBeDefined();
    expect(authWs?.commits.length).toBe(2);

    const billingWs = timeline.workstreams.find(
      (w) => w.scope === "billing" || w.name.toLowerCase().includes("billing"),
    );
    expect(billingWs).toBeDefined();
    expect(billingWs?.commits.length).toBe(1);
  });

  it("clusters commits associated with the same work-item issue key", async () => {
    await repo.writeFile("src/feature.ts", "const a = 1;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat: start feature (DEV-142)"], { cwd: repo.path });

    await repo.writeFile("src/feature-test.ts", "const b = 2;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "test: add tests for DEV-142"], { cwd: repo.path });

    const timeline = await getCommitTimeline(repo.path);
    const dev142Ws = timeline.workstreams.find((w) => w.workItems.includes("DEV-142"));
    expect(dev142Ws).toBeDefined();
    expect(dev142Ws?.commits).toHaveLength(2);
    expect(dev142Ws?.confidence).toBe("high");
  });

  it("links revert commits to their target commit in the same workstream", async () => {
    await repo.writeFile("src/bug.ts", "const bug = true;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(core): introduce faulty logic"], { cwd: repo.path });

    const originalHash = (await runGit(["rev-parse", "HEAD"], { cwd: repo.path })).stdout.trim();

    await runGit(["revert", "--no-edit", originalHash], { cwd: repo.path });

    const timeline = await getCommitTimeline(repo.path);
    expect(timeline.commits).toHaveLength(2);

    const revertCommit = timeline.commits.find((c) => c.isRevert);
    expect(revertCommit).toBeDefined();
    expect(revertCommit?.revertsHash?.slice(0, 7)).toBe(originalHash.slice(0, 7));

    // Both original and revert should be grouped into the same workstream
    const ws = timeline.workstreams.find((w) => w.commits.some((c) => c.isRevert));
    expect(ws?.commits).toHaveLength(2);
  });
});
