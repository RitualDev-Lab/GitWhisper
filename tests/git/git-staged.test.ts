import {
  commitStagedChanges,
  getStagedDiff,
  getStagedFiles,
  getStagedStats,
  hasStagedChanges,
  runGit,
} from "@gitwhisper/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

describe("Git Staged Changes & Commit Execution", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-staged-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("reports hasStagedChanges = false when nothing is staged", async () => {
    expect(await hasStagedChanges(repo.path)).toBe(false);
    expect(await getStagedFiles(repo.path)).toEqual([]);
  });

  it("detects added files accurately", async () => {
    await repo.writeFile("src/new-file.ts", "console.log('new');\n");
    await runGit(["add", "src/new-file.ts"], { cwd: repo.path });

    expect(await hasStagedChanges(repo.path)).toBe(true);

    const files = await getStagedFiles(repo.path);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/new-file.ts");
    expect(files[0].status).toBe("added");
    expect(files[0].binary).toBe(false);

    const stats = await getStagedStats(repo.path);
    expect(stats.filesChanged).toBe(1);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(0);
  });

  it("detects modified and deleted files", async () => {
    // Initial commit
    await repo.writeFile("file-to-modify.txt", "line 1\nline 2\n");
    await repo.writeFile("file-to-delete.txt", "delete me\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "init"], { cwd: repo.path });

    // Modify one, delete another
    await repo.writeFile("file-to-modify.txt", "line 1\nline 2 updated\nline 3 added\n");
    await repo.deleteFile("file-to-delete.txt");

    await runGit(["add", "."], { cwd: repo.path });

    const files = await getStagedFiles(repo.path);
    expect(files).toHaveLength(2);

    const modified = files.find((f) => f.path === "file-to-modify.txt");
    const deleted = files.find((f) => f.path === "file-to-delete.txt");

    expect(modified?.status).toBe("modified");
    expect(deleted?.status).toBe("deleted");

    const diff = await getStagedDiff(repo.path);
    expect(diff).toContain("file-to-modify.txt");
    expect(diff).toContain("file-to-delete.txt");
  });

  it("detects renamed files and tracks previousPath", async () => {
    await repo.writeFile("old-name.txt", "content of file\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "init"], { cwd: repo.path });

    await runGit(["mv", "old-name.txt", "new-name.txt"], { cwd: repo.path });

    const files = await getStagedFiles(repo.path);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("renamed");
    expect(files[0].path).toBe("new-name.txt");
    expect(files[0].previousPath).toBe("old-name.txt");
  });

  it("detects binary files without treating them as text", async () => {
    // Write 100 random binary bytes
    const binaryBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    await repo.writeFile("assets/image.png", binaryBuffer);
    await runGit(["add", "assets/image.png"], { cwd: repo.path });

    const files = await getStagedFiles(repo.path);
    expect(files).toHaveLength(1);
    expect(files[0].binary).toBe(true);
    expect(files[0].status).toBe("added");
  });

  it("captures staged content when file has both staged and unstaged edits", async () => {
    await repo.writeFile("mixed.txt", "line A\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "init"], { cwd: repo.path });

    // Stage "line B"
    await repo.writeFile("mixed.txt", "line A\nline B (staged)\n");
    await runGit(["add", "mixed.txt"], { cwd: repo.path });

    // Unstaged "line C"
    await repo.writeFile("mixed.txt", "line A\nline B (staged)\nline C (unstaged)\n");

    const diff = await getStagedDiff(repo.path);
    expect(diff).toContain("line B (staged)");
    expect(diff).not.toContain("line C (unstaged)");
  });

  it("executes real git commit and returns authoritative commit hash", async () => {
    await repo.writeFile("feature.txt", "new feature\n");
    await runGit(["add", "feature.txt"], { cwd: repo.path });

    const result = await commitStagedChanges(repo.path, {
      subject: "feat: implement test feature",
      body: "Detailed description of test feature.",
    });

    expect(result.commitHash).toMatch(/^[a-f0-9]+$/);

    // Verify hash matches actual git rev-parse
    const actualHash = (
      await runGit(["rev-parse", "--short", "HEAD"], { cwd: repo.path })
    ).stdout.trim();
    expect(result.commitHash).toBe(actualHash);

    // Verify commit message in git log
    const log = (await runGit(["log", "-1", "--pretty=%B"], { cwd: repo.path })).stdout;
    expect(log).toContain("feat: implement test feature");
    expect(log).toContain("Detailed description of test feature.");
  });
});
