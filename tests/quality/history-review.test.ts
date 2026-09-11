import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCommitDetails, runGit } from "@gitwhisper/git";
import { checkCommitQuality } from "@gitwhisper/core";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

describe("Historical Commit Review & Details Extraction", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-quality-history-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("extracts commit details from HEAD and validates commit message quality", async () => {
    await repo.writeFile("src/login.ts", "export const login = () => true;");
    await runGit(["add", "."], { cwd: repo.dir });
    await runGit(
      [
        "commit",
        "-m",
        "feat(auth): implement basic login function\n\nHandles user login verification.",
      ],
      { cwd: repo.dir },
    );

    const details = await getCommitDetails(repo.dir, "HEAD");
    expect(details).not.toBeNull();
    expect(details?.message).toContain("feat(auth): implement basic login function");
    expect(details?.changedFiles.some((f) => f.path === "src/login.ts")).toBe(true);
    expect(details?.patch).toContain("+export const login = () => true;");

    const result = await checkCommitQuality({
      message: details!.message,
      policy: {
        style: "conventional",
        allowedTypes: ["feat", "fix", "docs"],
        scopes: ["auth"],
        requiredScopes: [],
        strictScopes: true,
        maxSubjectLength: 72,
        requireScope: true,
        requireWorkItem: false,
        workItemMode: "reference",
        allowVagueDescriptions: false,
      },
    });

    expect(result.valid).toBe(true);
    expect(result.rating).toBe("excellent");
  });

  it("detects quality flaws in historical commits (e.g. HEAD~1)", async () => {
    // Commit 1: Flawed commit
    await repo.writeFile("file1.txt", "content 1");
    await runGit(["add", "."], { cwd: repo.dir });
    await runGit(["commit", "-m", "update stuff"], { cwd: repo.dir });

    // Commit 2: Good commit
    await repo.writeFile("file2.txt", "content 2");
    await runGit(["add", "."], { cwd: repo.dir });
    await runGit(["commit", "-m", "docs: update file2 documentation"], { cwd: repo.dir });

    // Check HEAD~1 (the flawed commit)
    const details = await getCommitDetails(repo.dir, "HEAD~1");
    expect(details).not.toBeNull();
    expect(details?.message).toBe("update stuff");

    const result = await checkCommitQuality({
      message: details!.message,
      policy: {
        style: "conventional",
        allowedTypes: ["feat", "fix", "docs"],
        scopes: [],
        requiredScopes: [],
        strictScopes: false,
        maxSubjectLength: 72,
        requireScope: false,
        requireWorkItem: false,
        workItemMode: "reference",
        allowVagueDescriptions: false,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "VAGUE_DESCRIPTION")).toBe(true);
  });

  it("returns null when commit-ish does not exist", async () => {
    const details = await getCommitDetails(repo.dir, "non-existent-branch-or-sha");
    expect(details).toBeNull();
  });
});
