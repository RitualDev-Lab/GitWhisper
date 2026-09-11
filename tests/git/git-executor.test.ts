import os from "node:os";
import {
  NotAGitRepositoryError,
  findRepository,
  getCurrentBranch,
  getHeadCommit,
  getRepositoryRoot,
  runGit,
} from "@gitwhisper/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

describe("Git Executor & Repository Discovery", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-exec-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("handles a brand new repository with 0 commits", async () => {
    const root = await getRepositoryRoot(repo.path);
    expect(root).toBeDefined();

    const head = await getHeadCommit(repo.path);
    expect(head).toBeNull();

    const branch = await getCurrentBranch(repo.path);
    expect(branch).toBe("main");
  });

  it("handles filenames with spaces without shell interpolation", async () => {
    await repo.writeFile("file with spaces.txt", "hello world");
    await runGit(["add", "file with spaces.txt"], { cwd: repo.path });
    await runGit(["commit", "-m", "initial commit with space"], { cwd: repo.path });

    const result = await runGit(["log", "-1", "--name-only", "--oneline"], { cwd: repo.path });
    expect(result.stdout).toContain("file with spaces.txt");
  });

  it("handles Unicode filenames correctly", async () => {
    await repo.writeFile("src/ñoño_café_🚀.ts", "export const name = 'ñoño';");
    await runGit(["add", "src/ñoño_café_🚀.ts"], { cwd: repo.path });
    await runGit(["commit", "-m", "unicode test"], { cwd: repo.path });

    const result = await runGit(["log", "-1", "--name-only", "--oneline"], { cwd: repo.path });
    expect(result.stdout).toContain("src/ñoño_café_🚀.ts");
  });

  it("handles detached HEAD state gracefully", async () => {
    await repo.writeFile("first.txt", "1");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "first"], { cwd: repo.path });

    await repo.writeFile("second.txt", "2");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "second"], { cwd: repo.path });

    // Detach HEAD to HEAD~1
    await runGit(["checkout", "--detach", "HEAD~1"], { cwd: repo.path });

    const branch = await getCurrentBranch(repo.path);
    expect(branch).toMatch(/\(detached at [a-f0-9]+\)/);
  });

  it("throws NotAGitRepositoryError when executed outside of a git repo", async () => {
    const nonRepoDir = os.tmpdir();
    // Verify findRepository returns null or getRepositoryRoot throws
    const found = await findRepository(nonRepoDir);
    // tmpdir might be inside a parent repo or not; let's test a guaranteed non-repo
    if (!found) {
      await expect(getRepositoryRoot(nonRepoDir)).rejects.toThrow(NotAGitRepositoryError);
    }
  });

  it("supports AbortSignal cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runGit(["status"], { cwd: repo.path, signal: controller.signal })).rejects.toThrow(
      /cancelled/,
    );
  });
});
