import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitStagedChanges, getStagedFiles, runGit } from "@gitwhisper/git";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

describe("Phase 6 Real Git Composer Execution & Data-Loss Invariants", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-composer-git-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("safely commits selected variant while preserving unstaged modifications and untracked files", async () => {
    // 1. Initial commit
    await repo.writeFile("src/config.ts", "export const config = { v: 1 };\n");
    await runGit(["add", "src/config.ts"], { cwd: repo.path });
    await commitStagedChanges(repo.path, { subject: "chore: init config" });

    // 2. Stage a change in src/config.ts
    await repo.writeFile("src/config.ts", "export const config = { v: 2 };\n");
    await runGit(["add", "src/config.ts"], { cwd: repo.path });

    // 3. Add an UNSTAGED working-tree modification to src/config.ts (MM status in git status)
    await repo.writeFile(
      "src/config.ts",
      "export const config = { v: 2, unstagedLocalWork: true };\n",
    );

    // 4. Add an UNTRACKED private file (?? status)
    const secretPath = path.join(repo.path, ".env.secret");
    await fs.writeFile(secretPath, "SUPER_SECRET_KEY=12345\n");

    // Check status: config.ts is MM, .env.secret is ??
    const { stdout: statusBefore } = await runGit(["status", "--porcelain"], { cwd: repo.path });
    expect(statusBefore).toContain("MM src/config.ts");
    expect(statusBefore).toContain("?? .env.secret");

    // 5. Execute commit of staged changes
    const commitResult = await commitStagedChanges(repo.path, {
      subject: "feat(config): bump version to v2",
      body: "Update configuration version constant to v2.",
    });

    expect(commitResult.commitHash).toMatch(/^[0-9a-f]{7,40}$/);

    // 6. Verify commit content contains v: 2 but NOT unstagedLocalWork
    const { stdout: showOutput } = await runGit(["show", commitResult.commitHash], {
      cwd: repo.path,
    });
    expect(showOutput).toContain("+export const config = { v: 2 };");
    expect(showOutput).not.toContain("unstagedLocalWork");

    // 7. Verify Working-Tree Preserved:
    // The file on disk MUST still have the unstaged local work!
    const fileOnDisk = await fs.readFile(path.join(repo.path, "src/config.ts"), "utf-8");
    expect(fileOnDisk).toContain("unstagedLocalWork: true");

    // The untracked secret file MUST still exist completely untouched!
    const secretOnDisk = await fs.readFile(secretPath, "utf-8");
    expect(secretOnDisk).toBe("SUPER_SECRET_KEY=12345\n");

    // Git status now shows config.ts has unstaged modification, and secret is untracked
    const { stdout: statusAfter } = await runGit(["status", "--porcelain"], { cwd: repo.path });
    expect(statusAfter).toContain(" M src/config.ts");
    expect(statusAfter).toContain("?? .env.secret");
  });
});
