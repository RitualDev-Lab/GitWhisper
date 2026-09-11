import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { GitError, runGit } from "./executor.js";
import { CommitHookFailedError } from "./commit.js";
import { getIndexFingerprint } from "./index-ops.js";
import type { GitCommitResult, GitStateSnapshot } from "./types.js";

/**
 * Validates whether a patch can apply cleanly to the given index file.
 * If no tempIndexFile is provided, creates an isolated temporary index initialized to HEAD.
 */
export async function validatePatchWithGit(
  repoRoot: string,
  patchContent: string,
  tempIndexFile?: string,
): Promise<{ valid: boolean; error?: string }> {
  let indexFile = tempIndexFile;
  let shouldCleanup = false;

  if (!indexFile) {
    shouldCleanup = true;
    indexFile = path.join(repoRoot, ".git", `temp-validate-index-${crypto.randomUUID()}`);
    try {
      await runGit(["read-tree", "HEAD"], {
        cwd: repoRoot,
        env: { GIT_INDEX_FILE: indexFile },
      });
    } catch {
      await fs.writeFile(indexFile, "");
    }
  }

  try {
    return await new Promise<{ valid: boolean; error?: string }>((resolve) => {
      const child = spawn("git", ["apply", "--check", "--cached", "--recount"], {
        cwd: repoRoot,
        env: { ...process.env, GIT_INDEX_FILE: indexFile },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve({ valid: true });
        } else {
          resolve({ valid: false, error: stderr.trim() });
        }
      });

      child.stdin.write(patchContent);
      child.stdin.end();
    });
  } finally {
    if (shouldCleanup && indexFile) {
      try {
        await fs.rm(indexFile, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Applies a patch to an isolated temporary index file without touching the working tree.
 */
export async function applyPatchToIsolatedIndex(
  repoRoot: string,
  patchContent: string,
  tempIndexFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["apply", "--cached", "--recount"], {
      cwd: repoRoot,
      env: { ...process.env, GIT_INDEX_FILE: tempIndexFile },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Failed to apply patch to temporary index: ${stderr.trim()}`));
      }
    });

    child.stdin.write(patchContent);
    child.stdin.end();
  });
}

/**
 * Executes an isolated partial commit from a generated patch using a temporary index.
 * Completely isolates the working tree and preserves unstaged/untracked files.
 * Executes real Git hooks (pre-commit, commit-msg).
 */
export async function executeHunkGroupCommit(
  repoRoot: string,
  options: {
    patchContent?: string;
    patchString?: string;
    subject: string;
    body?: string;
    tempIndexFile?: string;
  },
): Promise<GitCommitResult> {
  const patchContent = options.patchContent ?? options.patchString;
  if (!patchContent) {
    throw new Error("executeHunkGroupCommit requires patchContent or patchString.");
  }
  const { subject, body } = options;
  const tempIndexFile =
    options.tempIndexFile ??
    path.join(repoRoot, ".git", `temp-commit-index-${crypto.randomUUID()}`);
  const isSelfManagedIndex = !options.tempIndexFile;

  try {
    // Initialize the temporary index to match current HEAD
    try {
      await runGit(["read-tree", "HEAD"], {
        cwd: repoRoot,
        env: { GIT_INDEX_FILE: tempIndexFile },
      });
    } catch {
      // 0-commit initial repository: start with empty file
      await fs.writeFile(tempIndexFile, "");
    }

    // Validate patch first
    const validation = await validatePatchWithGit(repoRoot, patchContent, tempIndexFile);
    if (!validation.valid) {
      throw new Error(`Selected hunk patch cannot be cleanly applied: ${validation.error}`);
    }

    // Apply patch to temporary index
    await applyPatchToIsolatedIndex(repoRoot, patchContent, tempIndexFile);

    // Execute real git commit with GIT_INDEX_FILE so hooks execute
    const commitArgs = ["commit", "-m", subject];
    if (body && body.trim().length > 0) {
      commitArgs.push("-m", body.trim());
    }

    let commitRun: { stdout: string; stderr: string; exitCode: number } | undefined;
    try {
      commitRun = await runGit(commitArgs, {
        cwd: repoRoot,
        env: { GIT_INDEX_FILE: tempIndexFile },
      });
    } catch (err: any) {
      if (err instanceof GitError) {
        const stderr = err.stderr.toLowerCase();
        const stdout = err.stdout.toLowerCase();
        const combined = `${stderr}\n${stdout}`;

        if (
          combined.includes("pre-commit hook failed") ||
          combined.includes("pre-commit") ||
          combined.includes("hook declined")
        ) {
          throw new CommitHookFailedError("pre-commit", err.stderr || err.stdout);
        }
        if (
          combined.includes("commit-msg hook failed") ||
          combined.includes("commit-msg") ||
          combined.includes("hook")
        ) {
          throw new CommitHookFailedError("commit-msg", err.stderr || err.stdout);
        }
      }
      throw err;
    }

    const hashResult = await runGit(["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      env: { GIT_INDEX_FILE: tempIndexFile },
    });

    return {
      commitHash: hashResult.stdout.trim(),
      fullOutput: commitRun.stdout,
    };
  } finally {
    if (isSelfManagedIndex) {
      try {
        await fs.rm(tempIndexFile, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Computes SHA-256 hash of a file on disk.
 */
async function hashFileOnDisk(filePath: string): Promise<string> {
  try {
    const data = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return "DELETED";
  }
}

/**
 * Captures a lightweight snapshot of Git state before executing partial commits.
 */
export async function captureStateSnapshot(
  repoRoot: string,
  filesToTrack?: string[],
): Promise<GitStateSnapshot> {
  let head = "0000000000000000000000000000000000000000";
  try {
    const headRes = await runGit(["rev-parse", "HEAD"], { cwd: repoRoot });
    head = headRes.stdout.trim();
  } catch {
    // initial repo
  }

  const indexFingerprint = await getIndexFingerprint(repoRoot);

  const untrackedRes = await runGit(["ls-files", "--others", "--exclude-standard"], {
    cwd: repoRoot,
  });
  const untrackedPaths = untrackedRes.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let files = filesToTrack;
  if (!files || files.length === 0) {
    try {
      const diffRes = await runGit(["diff", "--name-only"], { cwd: repoRoot });
      files = diffRes.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      files = [];
    }
  }

  const workingTreeFileHashes: Record<string, string> = {};
  for (const relPath of files) {
    const fullPath = path.join(repoRoot, relPath);
    workingTreeFileHashes[relPath] = await hashFileOnDisk(fullPath);
  }

  return {
    head,
    indexFingerprint,
    untrackedPaths,
    workingTreeFileHashes,
  };
}

/**
 * Verifies that working tree disk files and untracked files are untouched.
 */
export async function verifyWorkingTreeUnchanged(
  repoRoot: string,
  snapshot: GitStateSnapshot,
): Promise<boolean> {
  for (const [relPath, expectedHash] of Object.entries(snapshot.workingTreeFileHashes)) {
    const fullPath = path.join(repoRoot, relPath);
    const currentHash = await hashFileOnDisk(fullPath);
    if (currentHash !== expectedHash) {
      return false;
    }
  }

  const untrackedRes = await runGit(["ls-files", "--others", "--exclude-standard"], {
    cwd: repoRoot,
  });
  const currentUntracked = untrackedRes.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const currentSet = new Set(currentUntracked);
  for (const orig of snapshot.untrackedPaths) {
    if (!currentSet.has(orig)) {
      return false;
    }
  }

  return true;
}

/**
 * Updates primary index with remaining uncommitted hunks based on new HEAD.
 */
export async function updatePrimaryIndexWithRemainingHunks(
  repoRoot: string,
  remainingPatch: string,
  tempIndexFile?: string,
): Promise<void> {
  const indexFile =
    tempIndexFile ?? path.join(repoRoot, ".git", `temp-update-index-${crypto.randomUUID()}`);
  const isSelfManaged = !tempIndexFile;

  try {
    // 1. Initialize temporary index to new HEAD
    await runGit(["read-tree", "HEAD"], {
      cwd: repoRoot,
      env: { GIT_INDEX_FILE: indexFile },
    });

    // 2. If there are remaining staged hunks, apply them to the new index
    if (remainingPatch.trim().length > 0) {
      await applyPatchToIsolatedIndex(repoRoot, remainingPatch, indexFile);
    }

    // 3. Atomically copy the temporary index to .git/index
    const primaryIndex = path.join(repoRoot, ".git", "index");
    await fs.copyFile(indexFile, primaryIndex);
  } finally {
    if (isSelfManaged) {
      try {
        await fs.rm(indexFile, { force: true });
      } catch {
        // ignore
      }
    }
  }
}
