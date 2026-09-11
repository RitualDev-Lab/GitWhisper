import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitStagedChanges,
  executeIsolatedGroupCommit,
  getIndexFingerprint,
  getStagedIndexEntries,
  runGit,
  syncPrimaryIndex,
} from "@gitwhisper/git";

describe("Phase 4 Safety & Zero-Data-Loss Invariants", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-safety-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Safety Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "safety@gitwhisper.local"], { cwd: tempDir });
    // Initial root commit
    await fs.writeFile(path.join(tempDir, "README.md"), "# Root\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: root commit" });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Test A: preserves unstaged working-tree modifications during isolated group commit", async () => {
    // Stage fileA.txt with staged content "STAGED_CONTENT_V1"
    const fileAPath = path.join(tempDir, "fileA.txt");
    await fs.writeFile(fileAPath, "STAGED_CONTENT_V1\n");
    await runGit(["add", "fileA.txt"], { cwd: tempDir });

    // Modify fileA.txt in working-tree with "UNSTAGED_WORKING_TREE_V2" WITHOUT git add
    await fs.writeFile(fileAPath, "UNSTAGED_WORKING_TREE_V2\n");

    // Also stage fileB.txt
    const fileBPath = path.join(tempDir, "fileB.txt");
    await fs.writeFile(fileBPath, "FILE_B_CONTENT\n");
    await runGit(["add", "fileB.txt"], { cwd: tempDir });

    const stagedEntries = await getStagedIndexEntries(tempDir);
    const tempIndexFile = path.join(tempDir, ".git", "temp-split-index");

    // Execute isolated commit for group containing only fileA.txt
    const commitResult = await executeIsolatedGroupCommit(tempDir, {
      files: ["fileA.txt"],
      stagedEntries,
      subject: "feat(a): commit staged changes for file A",
      tempIndexFile,
    });

    // Synchronize primary index to reflect new HEAD while keeping fileB staged
    await syncPrimaryIndex(tempDir, tempIndexFile);
    await fs.unlink(tempIndexFile);

    // 1. Verify HEAD commit contains STAGED_CONTENT_V1
    const headFileContent = await runGit(["show", `${commitResult.commitHash}:fileA.txt`], {
      cwd: tempDir,
    });
    expect(headFileContent.stdout).toContain("STAGED_CONTENT_V1");

    // 2. CRITICAL: Verify working-tree STILL contains UNSTAGED_WORKING_TREE_V2!
    const diskContent = await fs.readFile(fileAPath, "utf8");
    expect(diskContent).toContain("UNSTAGED_WORKING_TREE_V2");

    // 3. Verify git status shows working tree modification
    const status = await runGit(["status", "--porcelain"], { cwd: tempDir });
    // fileA.txt must be modified in working tree (not committed)
    expect(status.stdout).toContain(" M fileA.txt");
  });

  it("Test B: untracked files (.env, scratch) are NEVER committed or mutated", async () => {
    // Create untracked sensitive .env and scratch files
    const envPath = path.join(tempDir, ".env");
    await fs.writeFile(envPath, "SECRET_API_KEY=super_confidential\n");

    const scratchPath = path.join(tempDir, "scratch.txt");
    await fs.writeFile(scratchPath, "personal notes\n");

    // Stage source files
    await fs.writeFile(path.join(tempDir, "service.ts"), "export const service = true;\n");
    await fs.writeFile(path.join(tempDir, "component.tsx"), "export const Comp = () => null;\n");
    await runGit(["add", "service.ts", "component.tsx"], { cwd: tempDir });

    const stagedEntries = await getStagedIndexEntries(tempDir);
    const tempIndex = path.join(tempDir, ".git", "test-b-index");

    // Commit service.ts in Group 1
    const c1 = await executeIsolatedGroupCommit(tempDir, {
      files: ["service.ts"],
      stagedEntries,
      subject: "feat(backend): add service",
      tempIndexFile: tempIndex,
    });

    // Commit component.tsx in Group 2
    const c2 = await executeIsolatedGroupCommit(tempDir, {
      files: ["component.tsx"],
      stagedEntries,
      subject: "feat(frontend): add component",
      tempIndexFile: tempIndex,
    });

    await syncPrimaryIndex(tempDir, tempIndex);
    await fs.unlink(tempIndex);

    // Check git log of created commits
    const log = await runGit(["log", "-n", "2", "--name-only", "--pretty=format:%H"], {
      cwd: tempDir,
    });
    expect(log.stdout).not.toContain(".env");
    expect(log.stdout).not.toContain("scratch.txt");

    // Verify untracked files still exist with untouched contents
    expect(await fs.readFile(envPath, "utf8")).toBe("SECRET_API_KEY=super_confidential\n");
    expect(await fs.readFile(scratchPath, "utf8")).toBe("personal notes\n");

    // Git status shows ?? for untracked files
    const status = await runGit(["status", "--porcelain"], { cwd: tempDir });
    expect(status.stdout).toContain("?? .env");
    expect(status.stdout).toContain("?? scratch.txt");
  });

  it("Test C: Git hooks are executed and failure halts subsequent groups", async () => {
    // Install commit-msg hook that rejects commits with "HOOK_FAIL"
    const hooksDir = path.join(tempDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const hookScript = path.join(hooksDir, "commit-msg");

    // Cross-platform shell script for git hook
    await fs.writeFile(
      hookScript,
      `#!/bin/sh\ngrep -q "HOOK_FAIL" "$1" && echo "REJECTED BY HOOK" >&2 && exit 1\nexit 0\n`,
    );
    // Make executable if on POSIX
    try {
      await fs.chmod(hookScript, 0o755);
    } catch {
      // windows
    }

    await fs.writeFile(path.join(tempDir, "file1.ts"), "const f1 = 1;\n");
    await fs.writeFile(path.join(tempDir, "file2.ts"), "const f2 = 2;\n");
    await runGit(["add", "file1.ts", "file2.ts"], { cwd: tempDir });

    const stagedEntries = await getStagedIndexEntries(tempDir);
    const tempIndex = path.join(tempDir, ".git", "hook-index");

    // Group 1 commit passes
    const res1 = await executeIsolatedGroupCommit(tempDir, {
      files: ["file1.ts"],
      stagedEntries,
      subject: "feat: group 1 commit",
      tempIndexFile: tempIndex,
    });
    expect(res1.commitHash).toBeDefined();

    // Group 2 commit triggers hook failure
    await expect(
      executeIsolatedGroupCommit(tempDir, {
        files: ["file2.ts"],
        stagedEntries,
        subject: "feat: HOOK_FAIL group 2",
        tempIndexFile: tempIndex,
      }),
    ).rejects.toThrow();

    // Cleanup temp index
    try {
      await fs.unlink(tempIndex);
    } catch {
      // ignore
    }
  });

  it("Test D: index fingerprint changes when index is mutated", async () => {
    await fs.writeFile(path.join(tempDir, "module.ts"), "export const x = 1;\n");
    await runGit(["add", "module.ts"], { cwd: tempDir });

    const originalFp = await getIndexFingerprint(tempDir);

    // Staging another file invalidates original fingerprint
    await fs.writeFile(path.join(tempDir, "other.ts"), "export const y = 2;\n");
    await runGit(["add", "other.ts"], { cwd: tempDir });

    const updatedFp = await getIndexFingerprint(tempDir);
    expect(updatedFp).not.toBe(originalFp);
  });
});
