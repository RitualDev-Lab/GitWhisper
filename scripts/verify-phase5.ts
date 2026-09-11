import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  captureStateSnapshot,
  commitStagedChanges,
  executeHunkGroupCommit,
  getStagedDiff,
  runGit,
  updatePrimaryIndexWithRemainingHunks,
  validatePatchWithGit,
  verifyWorkingTreeUnchanged,
} from "../packages/git/dist/index.js";
import { buildPatchSelection, parsePatch } from "../packages/core/dist/index.js";

async function main() {
  console.log("===============================================================");
  console.log("GitWhisper Phase 5 Verification Script");
  console.log("Hunk-Level Diff Intelligence & Safe Partial Commit Execution");
  console.log("===============================================================\n");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-phase5-verify-"));
  console.log(`[1/7] Created temporary Git sandbox at: ${tempDir}`);

  try {
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Phase 5 Verifier"], { cwd: tempDir });
    await runGit(["config", "user.email", "verifier@gitwhisper.local"], { cwd: tempDir });

    // Step 1: Create src/app.ts with 3 distinct functions separated by padding
    console.log("[2/7] Initializing repository with 3-function module...");
    const appDir = path.join(tempDir, "src");
    await fs.mkdir(appDir, { recursive: true });
    const appFile = path.join(appDir, "app.ts");

    const initialSource = [
      "// Section 1: Authentication Handling",
      "export function handleAuthTimeout(session: string): boolean {",
      "  console.log('auth timeout: ' + session);",
      "  return false;",
      "}",
      "",
      "// Padding line 1",
      "// Padding line 2",
      "// Padding line 3",
      "// Padding line 4",
      "// Padding line 5",
      "// Padding line 6",
      "// Padding line 7",
      "// Padding line 8",
      "// Padding line 9",
      "// Padding line 10",
      "",
      "// Section 2: Navigation Analytics",
      "export function trackNavigation(route: string): void {",
      "  console.log('route navigated: ' + route);",
      "}",
      "",
      "// Padding line 11",
      "// Padding line 12",
      "// Padding line 13",
      "// Padding line 14",
      "// Padding line 15",
      "// Padding line 16",
      "// Padding line 17",
      "// Padding line 18",
      "// Padding line 19",
      "// Padding line 20",
      "",
      "// Section 3: Footer Layout",
      "export function renderFooter(): string {",
      "  return '<footer>Original Footer v1</footer>';",
      "}",
      "",
    ].join("\n");

    await fs.writeFile(appFile, initialSource, "utf8");
    await runGit(["add", "src/app.ts"], { cwd: tempDir });
    const rootCommit = await commitStagedChanges(tempDir, { subject: "chore: initial app setup" });
    console.log(`      ✓ Root commit created: ${rootCommit.commitHash}`);

    // Step 2: Stage edits to Function 1 and Function 2
    console.log("[3/7] Staging edits to Function 1 (Auth) and Function 2 (Navigation)...");
    const stagedSource = initialSource
      .replace(
        "console.log('auth timeout: ' + session);",
        "console.log('auth timeout intercepted: ' + session);\n  refreshSession(session);",
      )
      .replace(
        "console.log('route navigated: ' + route);",
        "console.log('route navigated with metrics: ' + route);\n  recordMetric('nav', route);",
      );

    await fs.writeFile(appFile, stagedSource, "utf8");
    await runGit(["add", "src/app.ts"], { cwd: tempDir });

    // Step 3: Introduce unstaged changes to Function 3 & untracked .env file
    console.log("[4/7] Introducing unstaged edits to Function 3 and untracked .env file...");
    const workingTreeSource = stagedSource.replace(
      "return '<footer>Original Footer v1</footer>';",
      "return '<footer>MODIFIED_UNSTAGED_FOOTER_ACTIVE</footer>';",
    );
    await fs.writeFile(appFile, workingTreeSource, "utf8");

    const envFile = path.join(tempDir, ".env");
    const envSecret =
      "SECRET_TOKEN=phase5_verification_vault_key_9999\nDATABASE_URL=postgres://local\n";
    await fs.writeFile(envFile, envSecret, "utf8");

    const statusPre = await runGit(["status", "--porcelain"], { cwd: tempDir });
    if (!statusPre.stdout.includes("MM src/app.ts") || !statusPre.stdout.includes("?? .env")) {
      throw new Error(`Unexpected initial status:\n${statusPre.stdout}`);
    }
    console.log("      ✓ Verified working-tree state: MM src/app.ts, ?? .env");

    // Step 4: Parse staged diff into structured hunks
    console.log("[5/7] Parsing staged diff and isolating hunks...");
    const stagedDiff = await getStagedDiff(tempDir);
    const parsedPatch = parsePatch(stagedDiff);

    if (parsedPatch.files.length !== 1 || parsedPatch.files[0].hunks.length !== 2) {
      throw new Error(
        `Expected 1 file with 2 hunks, got ${parsedPatch.files.length} files, ${parsedPatch.files[0]?.hunks.length} hunks`,
      );
    }

    const hunkAuth = parsedPatch.files[0].hunks[0];
    const hunkNav = parsedPatch.files[0].hunks[1];
    console.log(`      ✓ Staged Hunk 1: ${hunkAuth.id} (Function 1 Auth)`);
    console.log(`      ✓ Staged Hunk 2: ${hunkNav.id} (Function 2 Navigation)`);

    // Step 5: Execute Hunk Group 1 Commit (Auth only)
    console.log("[6/7] Executing partial commit 1 (Auth Hunk)...");
    const patchAuth = buildPatchSelection(parsedPatch, [hunkAuth.id]);
    const valid1 = await validatePatchWithGit(tempDir, patchAuth);
    if (!valid1.valid) throw new Error(`Patch 1 invalid: ${valid1.error}`);

    const snap1 = await captureStateSnapshot(tempDir);
    const commit1 = await executeHunkGroupCommit(tempDir, {
      patchContent: patchAuth,
      subject: "fix(auth): intercept timeout and refresh session",
    });
    console.log(`      ✓ Commit 1 successful: ${commit1.commitHash}`);

    const clean1 = await verifyWorkingTreeUnchanged(tempDir, snap1);
    if (!clean1) throw new Error("Data loss detected! Working tree modified during commit 1!");
    console.log("      ✓ Zero data loss verified after Commit 1");

    // Update primary index to retain Hunk 2
    const remainingPatch1 = buildPatchSelection(parsedPatch, [hunkNav.id]);
    await updatePrimaryIndexWithRemainingHunks(tempDir, remainingPatch1);

    // Step 6: Execute Hunk Group 2 Commit (Nav only)
    console.log("[7/7] Executing partial commit 2 (Navigation Hunk)...");
    const stagedDiff2 = await getStagedDiff(tempDir);
    const parsedPatch2 = parsePatch(stagedDiff2);
    const hunkNav2 = parsedPatch2.files[0].hunks[0];

    const patchNav = buildPatchSelection(parsedPatch2, [hunkNav2.id]);
    const valid2 = await validatePatchWithGit(tempDir, patchNav);
    if (!valid2.valid) throw new Error(`Patch 2 invalid: ${valid2.error}`);

    const snap2 = await captureStateSnapshot(tempDir);
    const commit2 = await executeHunkGroupCommit(tempDir, {
      patchContent: patchNav,
      subject: "feat(nav): record route metrics on navigation",
    });
    console.log(`      ✓ Commit 2 successful: ${commit2.commitHash}`);

    const clean2 = await verifyWorkingTreeUnchanged(tempDir, snap2);
    if (!clean2) throw new Error("Data loss detected! Working tree modified during commit 2!");
    console.log("      ✓ Zero data loss verified after Commit 2");

    // Clear remaining hunks from index
    await updatePrimaryIndexWithRemainingHunks(tempDir, "");

    // Final Invariant Checks
    console.log("\n--- Final Safety & Invariant Verification ---");

    // 1. Check Git Log
    const log = await runGit(["log", "--oneline"], { cwd: tempDir });
    const logFormatted = log.stdout
      .trim()
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    console.log(`Git Log History:\n${logFormatted}`);
    if (
      !log.stdout.includes("feat(nav): record route metrics on navigation") ||
      !log.stdout.includes("fix(auth): intercept timeout and refresh session")
    ) {
      throw new Error("Missing expected split commits in git log!");
    }

    // 2. Commit diff contents
    const show1 = await runGit(["show", commit1.commitHash], { cwd: tempDir });
    if (
      !show1.stdout.includes("refreshSession(session)") ||
      show1.stdout.includes("recordMetric")
    ) {
      throw new Error("Commit 1 diff has corrupted hunk boundaries!");
    }
    console.log("✓ Commit 1 contains strictly Function 1 changes.");

    const show2 = await runGit(["show", commit2.commitHash], { cwd: tempDir });
    if (!show2.stdout.includes("recordMetric") || show2.stdout.includes("refreshSession")) {
      throw new Error("Commit 2 diff has corrupted hunk boundaries!");
    }
    console.log("✓ Commit 2 contains strictly Function 2 changes.");

    // 3. Disk file integrity
    const currentAppDisk = await fs.readFile(appFile, "utf8");
    if (currentAppDisk !== workingTreeSource) {
      throw new Error("Working tree file src/app.ts was mutated on disk!");
    }
    if (!currentAppDisk.includes("MODIFIED_UNSTAGED_FOOTER_ACTIVE")) {
      throw new Error("Unstaged modifications to renderFooter were destroyed!");
    }
    console.log(
      "✓ Working-tree file src/app.ts on disk retains unstaged modifications byte-for-byte.",
    );

    // 4. Untracked file integrity
    const currentEnvDisk = await fs.readFile(envFile, "utf8");
    if (currentEnvDisk !== envSecret) {
      throw new Error("Untracked file .env was destroyed or mutated!");
    }
    console.log("✓ Untracked file .env is completely intact with original secrets.");

    // 5. Working tree diff & status
    const unstagedDiff = await runGit(["diff"], { cwd: tempDir });
    if (!unstagedDiff.stdout.includes("MODIFIED_UNSTAGED_FOOTER_ACTIVE")) {
      throw new Error("git diff does not show unstaged footer modification!");
    }
    console.log("✓ git diff shows ONLY the unstaged Function 3 footer modification.");

    const cachedDiff = await runGit(["diff", "--cached"], { cwd: tempDir });
    if (cachedDiff.stdout.trim().length !== 0) {
      throw new Error(`Unexpected staged changes remaining:\n${cachedDiff.stdout}`);
    }
    console.log("✓ git diff --cached is completely empty.");

    const finalStatus = await runGit(["status", "--porcelain"], { cwd: tempDir });
    const statusFormatted = finalStatus.stdout
      .trim()
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n");
    console.log(`Final git status:\n${statusFormatted}`);
    if (finalStatus.stdout !== " M src/app.ts\n?? .env\n") {
      throw new Error(`Unexpected final porcelain status: ${finalStatus.stdout}`);
    }
    console.log("✓ git status shows exactly ' M src/app.ts' and '?? .env'.");

    console.log("\n===============================================================");
    console.log("PHASE 5 VERIFICATION PASSED: ALL INVARIANTS SATISFIED 100%");
    console.log("===============================================================");
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error("\n❌ PHASE 5 VERIFICATION FAILED:", err);
  process.exit(1);
});
