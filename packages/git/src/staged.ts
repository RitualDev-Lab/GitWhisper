import { runGit } from "./executor.js";
import type { GitFileChange, GitFileStatus, GitStats } from "./types.js";

/**
 * Checks whether the repository has any staged changes.
 */
export async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  const result = await runGit(["diff", "--cached", "--name-only", "-z"], { cwd: repoRoot });
  return result.stdout.length > 0;
}

/**
 * Normalizes git status letters into our GitFileStatus union.
 */
export function normalizeStatus(statusCode: string): GitFileStatus {
  const code = statusCode.trim()[0];
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

/**
 * Parses `git diff --cached --name-status -z` output into file changes with paths and status.
 */
export function parseNameStatusZ(output: string): Array<{
  status: GitFileStatus;
  path: string;
  previousPath?: string;
}> {
  if (!output) return [];

  const tokens = output.split("\0");
  const changes: Array<{
    status: GitFileStatus;
    path: string;
    previousPath?: string;
  }> = [];

  let i = 0;
  while (i < tokens.length) {
    const rawStatus = tokens[i]?.trim();
    if (!rawStatus) {
      i++;
      continue;
    }

    const status = normalizeStatus(rawStatus);

    if (status === "renamed" || status === "copied") {
      const prev = tokens[i + 1];
      const next = tokens[i + 2];
      if (prev !== undefined && next !== undefined) {
        changes.push({
          status,
          previousPath: prev,
          path: next,
        });
      }
      i += 3;
    } else {
      const targetPath = tokens[i + 1];
      if (targetPath !== undefined && targetPath !== "") {
        changes.push({
          status,
          path: targetPath,
        });
      }
      i += 2;
    }
  }

  return changes;
}

interface NumstatEntry {
  additions: number;
  deletions: number;
  binary: boolean;
  path: string;
  previousPath?: string;
}

/**
 * Parses `git diff --cached --numstat -z` output.
 */
function parseNumstatZ(
  output: string,
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const map = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  if (!output) return map;

  const tokens = output.split("\0");
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) {
      i++;
      continue;
    }

    const parts = token.split("\t");
    if (parts.length >= 3) {
      const [addStr, delStr, filePath] = parts;
      const isBinary = addStr === "-" && delStr === "-";
      const additions = isBinary ? 0 : Number.parseInt(addStr, 10) || 0;
      const deletions = isBinary ? 0 : Number.parseInt(delStr, 10) || 0;

      map.set(filePath, { additions, deletions, binary: isBinary });
      i++;
    } else if (parts.length === 2 && (parts[0] === "-" || !Number.isNaN(Number(parts[0])))) {
      // Rename format in -z numstat: 'add\tdel\t\0oldPath\0newPath\0'
      const addStr = parts[0];
      const delStr = parts[1];
      const isBinary = addStr === "-" && delStr === "-";
      const additions = isBinary ? 0 : Number.parseInt(addStr, 10) || 0;
      const deletions = isBinary ? 0 : Number.parseInt(delStr, 10) || 0;

      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (newPath) {
        map.set(newPath, { additions, deletions, binary: isBinary });
      }
      i += 3;
    } else {
      i++;
    }
  }

  return map;
}

/**
 * Retrieves the list of currently staged files with status, additions, deletions, and binary flag.
 */
export async function getStagedFiles(repoRoot: string): Promise<GitFileChange[]> {
  const [nameStatusRes, numstatRes] = await Promise.all([
    runGit(["diff", "--cached", "--name-status", "-z"], { cwd: repoRoot }),
    runGit(["diff", "--cached", "--numstat", "-z"], { cwd: repoRoot }),
  ]);

  const rawChanges = parseNameStatusZ(nameStatusRes.stdout);
  const numstatMap = parseNumstatZ(numstatRes.stdout);

  return rawChanges.map((change) => {
    const numstat = numstatMap.get(change.path) ?? { additions: 0, deletions: 0, binary: false };
    return {
      path: change.path,
      previousPath: change.previousPath,
      status: change.status,
      additions: numstat.additions,
      deletions: numstat.deletions,
      binary: numstat.binary,
    };
  });
}

/**
 * Retrieves the raw unified diff of staged changes.
 */
export async function getStagedDiff(repoRoot: string): Promise<string> {
  const result = await runGit(["diff", "--cached", "--no-color", "--patch"], { cwd: repoRoot });
  return result.stdout;
}

/**
 * Aggregates statistics for all staged changes.
 */
export async function getStagedStats(repoRoot: string): Promise<GitStats> {
  const files = await getStagedFiles(repoRoot);

  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    if (!file.binary) {
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
  }

  return {
    filesChanged: files.length,
    additions,
    deletions,
  };
}
