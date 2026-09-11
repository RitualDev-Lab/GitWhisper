import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureStateSnapshot,
  commitStagedChanges,
  executeHunkGroupCommit,
  getStagedDiff,
  runGit,
  updatePrimaryIndexWithRemainingHunks,
  validatePatchWithGit,
  verifyWorkingTreeUnchanged,
} from "@gitwhisper/git";
import { buildPatchSelection, buildRemainingPatch, parsePatch } from "@gitwhisper/core";

describe("Phase 5 Hunk-Level Partial Staging & Zero-Data-Loss Invariants", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-hunk-safety-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Hunk Safety Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "hunk-safety@gitwhisper.local"], { cwd: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("safely commits separate hunks from a single file while preserving unstaged changes and untracked files", async () => {
    // 1. Initial commit with 3 functions separated by comments so git creates independent hunks
    const initialContent = [
      "// --- Function 1: Authentication ---",
      "export function handleAuthTimeout() {",
      "  console.log('original auth timeout');",
      "}",
      "",
      "// filler line 1",
      "// filler line 2",
      "// filler line 3",
      "// filler line 4",
      "// filler line 5",
      "// filler line 6",
      "// filler line 7",
      "// filler line 8",
      "// filler line 9",
      "// filler line 10",
      "",
      "// --- Function 2: Navigation ---",
      "export function trackNavigation() {",
      "  console.log('original navigation');",
      "}",
      "",
      "// filler line 11",
      "// filler line 12",
      "// filler line 13",
      "// filler line 14",
      "// filler line 15",
      "// filler line 16",
      "// filler line 17",
      "// filler line 18",
      "// filler line 19",
      "// filler line 20",
      "",
      "// --- Function 3: Rendering Footer ---",
      "export function renderFooter() {",
      "  console.log('original footer');",
      "}",
      "",
    ].join("\n");

    const appFilePath = path.join(tempDir, "src", "app.ts");
    await fs.mkdir(path.dirname(appFilePath), { recursive: true });
    await fs.writeFile(appFilePath, initialContent, "utf8");
    await runGit(["add", "src/app.ts"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: initial commit" });

    // 2. Stage edits to Function 1 and Function 2
    const stagedModifications = initialContent
      .replace(
        "console.log('original auth timeout');",
        "console.log('MODIFIED_AUTH_TIMEOUT_V1');\n  return true;",
      )
      .replace(
        "console.log('original navigation');",
        "console.log('MODIFIED_NAVIGATION_V1');\n  return true;",
      );

    await fs.writeFile(appFilePath, stagedModifications, "utf8");
    await runGit(["add", "src/app.ts"], { cwd: tempDir });

    // 3. Now modify Function 3 in the working-tree WITHOUT staging (unstaged modification)
    const workingTreeContent = stagedModifications.replace(
      "console.log('original footer');",
      "console.log('UNSTAGED_WORKING_TREE_FOOTER_MODIFICATION');",
    );
    await fs.writeFile(appFilePath, workingTreeContent, "utf8");

    // 4. Create an untracked file (.env)
    const envPath = path.join(tempDir, ".env");
    const secretContent = "DATABASE_URL=postgres://secret:pwd@localhost/db\nAPI_KEY=xyz987\n";
    await fs.writeFile(envPath, secretContent, "utf8");

    // Verify initial git status: src/app.ts is MM (both staged and unstaged), .env is ??
    const initialStatus = await runGit(["status", "--porcelain"], { cwd: tempDir });
    expect(initialStatus.stdout).toContain("MM src/app.ts");
    expect(initialStatus.stdout).toContain("?? .env");

    // 5. Parse staged patch and verify we have 2 distinct hunks
    const stagedDiff = await getStagedDiff(tempDir);
    const parsedPatch = parsePatch(stagedDiff);
    expect(parsedPatch.files).toHaveLength(1);
    expect(parsedPatch.files[0].hunks).toHaveLength(2);

    const hunk1 = parsedPatch.files[0].hunks[0];
    const hunk2 = parsedPatch.files[0].hunks[1];

    // Verify hunk contents
    expect(hunk1.lines.some((l) => l.content.includes("MODIFIED_AUTH_TIMEOUT_V1"))).toBe(true);
    expect(hunk2.lines.some((l) => l.content.includes("MODIFIED_NAVIGATION_V1"))).toBe(true);

    // 6. Build isolated patch for Group 1 (hunk1 only)
    const patch1 = buildPatchSelection(parsedPatch, [hunk1.id]);
    expect(patch1).toContain("MODIFIED_AUTH_TIMEOUT_V1");
    expect(patch1).not.toContain("MODIFIED_NAVIGATION_V1");

    // Validate patch with git
    const valid1 = await validatePatchWithGit(tempDir, patch1);
    expect(valid1.valid).toBe(true);

    // Snapshot state before commit
    const snapshotBefore1 = await captureStateSnapshot(tempDir);

    // Execute Group 1 Commit
    const commit1 = await executeHunkGroupCommit(tempDir, {
      patchContent: patch1,
      subject: "fix(auth): handle authentication timeout",
    });

    expect(commit1.commitHash).toMatch(/^[a-f0-9]{7,40}$/);

    // Verify working tree untouched after Group 1 commit
    const wtCheck1 = await verifyWorkingTreeUnchanged(tempDir, snapshotBefore1);
    expect(wtCheck1).toBe(true);

    // Update primary index to retain Group 2 (hunk2)
    const remainingPatch1 = buildPatchSelection(parsedPatch, [hunk2.id]);
    await updatePrimaryIndexWithRemainingHunks(tempDir, remainingPatch1);

    // Verify Group 2 is now staged in the primary index, unstaged footer is still unstaged!
    const midStatus = await runGit(["status", "--porcelain"], { cwd: tempDir });
    expect(midStatus.stdout).toContain("MM src/app.ts");
    expect(midStatus.stdout).toContain("?? .env");

    // 7. Build isolated patch for Group 2 (hunk2 only)
    const stagedDiff2 = await getStagedDiff(tempDir);
    const parsedPatch2 = parsePatch(stagedDiff2);
    expect(parsedPatch2.files[0].hunks).toHaveLength(1);
    const hunk2Updated = parsedPatch2.files[0].hunks[0];

    const patch2 = buildPatchSelection(parsedPatch2, [hunk2Updated.id]);
    expect(patch2).toContain("MODIFIED_NAVIGATION_V1");

    const valid2 = await validatePatchWithGit(tempDir, patch2);
    expect(valid2.valid).toBe(true);

    const snapshotBefore2 = await captureStateSnapshot(tempDir);

    // Execute Group 2 Commit
    const commit2 = await executeHunkGroupCommit(tempDir, {
      patchContent: patch2,
      subject: "feat(nav): track navigation analytics",
    });

    expect(commit2.commitHash).toMatch(/^[a-f0-9]{7,40}$/);

    // Verify working tree untouched after Group 2 commit
    const wtCheck2 = await verifyWorkingTreeUnchanged(tempDir, snapshotBefore2);
    expect(wtCheck2).toBe(true);

    // Remaining hunks after Group 2 is empty
    await updatePrimaryIndexWithRemainingHunks(tempDir, "");

    // 8. FINAL VERIFICATION:
    // A. Git log has 3 commits in total
    const log = await runGit(["log", "--oneline"], { cwd: tempDir });
    expect(log.stdout).toContain("feat(nav): track navigation analytics");
    expect(log.stdout).toContain("fix(auth): handle authentication timeout");
    expect(log.stdout).toContain("chore: initial commit");

    // B. Commit 1 diff only has auth changes
    const show1 = await runGit(["show", commit1.commitHash], { cwd: tempDir });
    expect(show1.stdout).toContain("MODIFIED_AUTH_TIMEOUT_V1");
    expect(show1.stdout).not.toContain("MODIFIED_NAVIGATION_V1");
    expect(show1.stdout).not.toContain("UNSTAGED_WORKING_TREE_FOOTER_MODIFICATION");

    // C. Commit 2 diff only has nav changes
    const show2 = await runGit(["show", commit2.commitHash], { cwd: tempDir });
    expect(show2.stdout).toContain("MODIFIED_NAVIGATION_V1");
    expect(show2.stdout).not.toContain("MODIFIED_AUTH_TIMEOUT_V1");
    expect(show2.stdout).not.toContain("UNSTAGED_WORKING_TREE_FOOTER_MODIFICATION");

    // D. Working tree file on disk STILL contains the unstaged footer changes byte-for-byte!
    const diskContent = await fs.readFile(appFilePath, "utf8");
    expect(diskContent).toBe(workingTreeContent);
    expect(diskContent).toContain("UNSTAGED_WORKING_TREE_FOOTER_MODIFICATION");

    // E. Untracked .env file is untouched!
    const envDiskContent = await fs.readFile(envPath, "utf8");
    expect(envDiskContent).toBe(secretContent);

    // F. git status shows only unstaged modifications to src/app.ts and untracked .env
    const finalStatus = await runGit(["status", "--porcelain"], { cwd: tempDir });
    expect(finalStatus.stdout).toBe(" M src/app.ts\n?? .env\n");

    // G. git diff shows ONLY the unstaged footer modification!
    const unstagedDiff = await runGit(["diff"], { cwd: tempDir });
    expect(unstagedDiff.stdout).toContain("UNSTAGED_WORKING_TREE_FOOTER_MODIFICATION");
    expect(unstagedDiff.stdout).not.toContain("MODIFIED_AUTH_TIMEOUT_V1");
    expect(unstagedDiff.stdout).not.toContain("MODIFIED_NAVIGATION_V1");

    // H. git diff --cached is completely empty!
    const cachedDiff = await runGit(["diff", "--cached"], { cwd: tempDir });
    expect(cachedDiff.stdout.trim()).toBe("");
  });
});
