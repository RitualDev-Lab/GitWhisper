import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CommitHookFailedError,
  commitStagedChanges,
  executeHunkGroupCommit,
  getStagedDiff,
  runGit,
  updatePrimaryIndexWithRemainingHunks,
  validatePatchWithGit,
} from "@gitwhisper/git";
import { buildPatchSelection, parsePatch } from "@gitwhisper/core";

describe("Phase 5 Hunk-Level Commit Hook Execution & Failure Safety", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-hook-hunk-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Hook Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "hook@gitwhisper.local"], { cwd: tempDir });
    // Root commit
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

  it("halts execution when a Git hook rejects group 2, leaving group 2 staged and group 1 committed", async () => {
    // 1. Install commit-msg hook that rejects commits with subject containing 'HOOK_FAIL'
    const hooksDir = path.join(tempDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const hookScript = path.join(hooksDir, "commit-msg");

    await fs.writeFile(
      hookScript,
      `#!/bin/sh\ngrep -q "HOOK_FAIL" "$1" && echo "REJECTED BY HOOK" >&2 && exit 1\nexit 0\n`,
    );
    try {
      await fs.chmod(hookScript, 0o755);
    } catch {
      // windows
    }

    // 2. Create file with 2 distinct hunks
    const initialContent = [
      "export function funcA() {",
      "  console.log('original a');",
      "}",
      "",
      "// line 1",
      "// line 2",
      "// line 3",
      "// line 4",
      "// line 5",
      "// line 6",
      "// line 7",
      "// line 8",
      "// line 9",
      "// line 10",
      "",
      "export function funcB() {",
      "  console.log('original b');",
      "}",
    ].join("\n");

    const appPath = path.join(tempDir, "app.ts");
    await fs.writeFile(appPath, initialContent, "utf8");
    await runGit(["add", "app.ts"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: init app.ts" });

    // 3. Stage edits to both functions
    const modifiedContent = initialContent
      .replace("console.log('original a');", "console.log('updated a');")
      .replace("console.log('original b');", "console.log('updated b');");

    await fs.writeFile(appPath, modifiedContent, "utf8");
    await runGit(["add", "app.ts"], { cwd: tempDir });

    // 4. Parse staged hunks
    const stagedDiff = await getStagedDiff(tempDir);
    const parsedPatch = parsePatch(stagedDiff);
    expect(parsedPatch.files[0].hunks).toHaveLength(2);

    const hunk1 = parsedPatch.files[0].hunks[0];
    const hunk2 = parsedPatch.files[0].hunks[1];

    const patch1 = buildPatchSelection(parsedPatch, [hunk1.id]);
    const patch2 = buildPatchSelection(parsedPatch, [hunk2.id]);

    // Group 1 commit passes
    const res1 = await executeHunkGroupCommit(tempDir, {
      patchContent: patch1,
      subject: "feat(a): function a update",
    });
    expect(res1.commitHash).toMatch(/^[a-f0-9]{7,40}$/);

    // Update primary index to retain Group 2
    await updatePrimaryIndexWithRemainingHunks(tempDir, patch2);

    // Group 2 commit triggers commit-msg hook rejection
    await expect(
      executeHunkGroupCommit(tempDir, {
        patchContent: patch2,
        subject: "feat(b): HOOK_FAIL group 2 commit",
      }),
    ).rejects.toThrow(CommitHookFailedError);

    // 5. Verify state after hook failure:
    // - Git log contains Group 1, but NOT Group 2
    const log = await runGit(["log", "--oneline"], { cwd: tempDir });
    expect(log.stdout).toContain("feat(a): function a update");
    expect(log.stdout).not.toContain("HOOK_FAIL");

    // - Primary index still has Group 2 staged!
    const remainingDiff = await getStagedDiff(tempDir);
    expect(remainingDiff).toContain("console.log('updated b');");
    expect(remainingDiff).not.toContain("console.log('updated a');");

    // - Working tree disk file is intact
    const diskContent = await fs.readFile(appPath, "utf8");
    expect(diskContent).toBe(modifiedContent);
  });
});
