import fs from "node:fs/promises";
import path from "node:path";
import { GitError, runGit } from "./executor.js";
import type { GitCommitResult, GitIndexEntry } from "./types.js";

export class MergeConflictError extends Error {
  constructor() {
    super(
      "GitWhisper cannot create or execute a commit plan while the repository contains unresolved merge conflicts.\nPlease resolve the conflicts first.",
    );
    this.name = "MergeConflictError";
  }
}

export class StaleIndexError extends Error {
  constructor() {
    super(
      "The staged repository state changed after this commit plan was generated.\nGitWhisper has aborted to prevent applying an outdated plan.",
    );
    this.name = "StaleIndexError";
  }
}

/**
 * Checks if the Git index has unresolved merge conflicts (stages 1, 2, or 3).
 */
export async function hasMergeConflicts(repoRoot: string): Promise<boolean> {
  try {
    const result = await runGit(["ls-files", "--unmerged"], { cwd: repoRoot });
    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Computes the authoritative Git tree fingerprint for the current staged index.
 * Throws MergeConflictError if the index has unresolved conflicts.
 */
export async function getIndexFingerprint(repoRoot: string): Promise<string> {
  const conflicts = await hasMergeConflicts(repoRoot);
  if (conflicts) {
    throw new MergeConflictError();
  }

  try {
    const result = await runGit(["write-tree"], { cwd: repoRoot });
    const hash = result.stdout.trim();
    if (!hash || hash.length < 40) {
      throw new Error(`Invalid tree hash returned by git write-tree: "${hash}"`);
    }
    return hash;
  } catch (err: any) {
    if (err.message?.includes("error building trees") || err.message?.includes("unmerged")) {
      throw new MergeConflictError();
    }
    throw err;
  }
}

/**
 * Extracts all authoritative staged entries (mode, blob hash, stage, path) from the index.
 */
export async function getStagedIndexEntries(repoRoot: string): Promise<GitIndexEntry[]> {
  const result = await runGit(["ls-files", "--stage", "-z"], { cwd: repoRoot });
  const raw = result.stdout;
  if (!raw) return [];

  const chunks = raw.split("\0").filter(Boolean);
  const entries: GitIndexEntry[] = [];

  for (const chunk of chunks) {
    const tabIdx = chunk.indexOf("\t");
    if (tabIdx === -1) continue;

    const metadata = chunk.slice(0, tabIdx);
    const filePath = chunk.slice(tabIdx + 1);

    const parts = metadata.split(" ");
    if (parts.length >= 3) {
      entries.push({
        mode: parts[0],
        hash: parts[1],
        stage: Number.parseInt(parts[2], 10),
        path: filePath,
      });
    }
  }

  return entries;
}

/**
 * Executes an isolated commit for an approved group using a temporary index file.
 * Preserves unstaged working-tree modifications and untracked files completely.
 * Runs real Git hooks (pre-commit, commit-msg).
 */
export async function executeIsolatedGroupCommit(
  repoRoot: string,
  options: {
    files: string[];
    stagedEntries: GitIndexEntry[];
    subject: string;
    body?: string;
    tempIndexFile: string;
  },
): Promise<GitCommitResult> {
  const { files, stagedEntries, subject, body, tempIndexFile } = options;

  // Initialize the temporary index to match current HEAD
  try {
    await runGit(["read-tree", "HEAD"], {
      cwd: repoRoot,
      env: { GIT_INDEX_FILE: tempIndexFile },
    });
  } catch {
    // 0-commit initial repository: start with empty index
    await fs.writeFile(tempIndexFile, "");
  }

  // Stage ONLY the files belonging to this group
  const entryMap = new Map<string, GitIndexEntry>();
  for (const entry of stagedEntries) {
    entryMap.set(entry.path, entry);
  }

  for (const file of files) {
    const entry = entryMap.get(file);
    if (entry) {
      // Added or modified file
      await runGit(
        ["update-index", "--add", "--cacheinfo", `${entry.mode},${entry.hash},${entry.path}`],
        {
          cwd: repoRoot,
          env: { GIT_INDEX_FILE: tempIndexFile },
        },
      );
    } else {
      // Deleted file
      await runGit(["update-index", "--force-remove", file], {
        cwd: repoRoot,
        env: { GIT_INDEX_FILE: tempIndexFile },
      });
    }
  }

  // Execute real git commit with GIT_INDEX_FILE so hooks execute
  const commitArgs = ["commit", "-m", subject];
  if (body && body.trim().length > 0) {
    commitArgs.push("-m", body.trim());
  }

  const commitRun = await runGit(commitArgs, {
    cwd: repoRoot,
    env: { GIT_INDEX_FILE: tempIndexFile },
  });

  const hashResult = await runGit(["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    env: { GIT_INDEX_FILE: tempIndexFile },
  });

  return {
    commitHash: hashResult.stdout.trim(),
    fullOutput: commitRun.stdout,
  };
}

/**
 * Safely updates the primary repository index (.git/index) from the temporary index.
 */
export async function syncPrimaryIndex(repoRoot: string, tempIndexFile: string): Promise<void> {
  const primaryIndex = path.join(repoRoot, ".git", "index");
  await fs.copyFile(tempIndexFile, primaryIndex);
}
