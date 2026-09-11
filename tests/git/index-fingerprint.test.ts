import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitStagedChanges,
  getIndexFingerprint,
  getStagedIndexEntries,
  hasMergeConflicts,
  runGit,
} from "@gitwhisper/git";

describe("Index Fingerprinting & Git Tree Plumbing", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-fingerprint-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Whisper Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "tester@gitwhisper.local"], { cwd: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("computes authoritative 40-character SHA-1 tree hash of staged index", async () => {
    await fs.writeFile(path.join(tempDir, "file1.txt"), "hello world\n");
    await runGit(["add", "file1.txt"], { cwd: tempDir });

    const fp1 = await getIndexFingerprint(tempDir);
    expect(fp1).toMatch(/^[0-9a-f]{40}$/);

    // Staging another file changes the fingerprint
    await fs.writeFile(path.join(tempDir, "file2.txt"), "second file\n");
    await runGit(["add", "file2.txt"], { cwd: tempDir });

    const fp2 = await getIndexFingerprint(tempDir);
    expect(fp2).toMatch(/^[0-9a-f]{40}$/);
    expect(fp2).not.toBe(fp1);
  });

  it("extracts exact index mode, blob hash, and stage for staged entries", async () => {
    await fs.writeFile(path.join(tempDir, "file.txt"), "content\n");
    await runGit(["add", "file.txt"], { cwd: tempDir });

    const entries = await getStagedIndexEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("file.txt");
    expect(entries[0].mode).toBe("100644");
    expect(entries[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(entries[0].stage).toBe(0);
  });

  it("detects merge conflicts accurately with hasMergeConflicts", async () => {
    // Initial commit on main
    await fs.writeFile(path.join(tempDir, "conflict.txt"), "original\n");
    await runGit(["add", "conflict.txt"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "initial commit" });

    // Branch A
    await runGit(["checkout", "-b", "branch-a"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "conflict.txt"), "branch a change\n");
    await runGit(["add", "conflict.txt"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "commit on branch A" });

    // Branch B from main
    await runGit(["checkout", "master"], { cwd: tempDir }).catch(async () => {
      await runGit(["checkout", "main"], { cwd: tempDir });
    });
    await runGit(["checkout", "-b", "branch-b"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "conflict.txt"), "branch b change\n");
    await runGit(["add", "conflict.txt"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "commit on branch B" });

    // Attempt merge to create conflict
    try {
      await runGit(["merge", "branch-a"], { cwd: tempDir });
    } catch {
      // merge fails with conflict
    }

    const conflict = await hasMergeConflicts(tempDir);
    expect(conflict).toBe(true);
  });
});
