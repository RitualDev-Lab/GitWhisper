import { runGit } from "./executor.js";
import { getHeadCommit } from "./repository.js";
import type {
  CommitDetails,
  CommitHistoryOptions,
  GitCommitRecord,
  GitFileChange,
} from "./types.js";

const RECORD_DELIMITER = "\x1e";
const FIELD_DELIMITER = "\x1f";

/**
 * Checks whether the repository is a shallow clone.
 */
export async function isShallowRepository(repoRoot: string): Promise<boolean> {
  try {
    const result = await runGit(["rev-parse", "--is-shallow-repository"], { cwd: repoRoot });
    return result.stdout.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

/**
 * Detects if a commit subject represents a revert commit.
 */
export function isRevertCommit(subject: string): boolean {
  const trimmed = subject.trim();
  return /^revert\b/i.test(trimmed) || /^revert\([^)]+\):/i.test(trimmed);
}

/**
 * Reads local Git commit history using structured machine-oriented delimiters.
 * Never executes shell interpolation; safe against multiline bodies, Unicode, and quotes.
 */
export async function getCommitHistory(
  repoRoot: string,
  options: CommitHistoryOptions = {},
): Promise<GitCommitRecord[]> {
  const {
    limit = 50,
    includeMerges = false,
    firstParent = false,
    since,
    withFiles = false,
  } = options;

  // Check if repository has any commits
  const head = await getHeadCommit(repoRoot);
  if (!head) {
    return [];
  }

  // Format with ASCII Record Separator (0x1E) and Unit Separator (0x1F)
  const format = withFiles
    ? `${RECORD_DELIMITER}%H${FIELD_DELIMITER}%P${FIELD_DELIMITER}%aI${FIELD_DELIMITER}%s${FIELD_DELIMITER}%b${FIELD_DELIMITER}`
    : `${RECORD_DELIMITER}%H${FIELD_DELIMITER}%P${FIELD_DELIMITER}%aI${FIELD_DELIMITER}%s${FIELD_DELIMITER}%b`;

  const args: string[] = ["log", `--max-count=${limit}`, `--format=${format}`];

  if (firstParent) {
    args.push("--first-parent");
  }

  if (since) {
    args.push(`--since=${since}`);
  }

  if (withFiles) {
    args.push("--name-only");
  }

  try {
    const result = await runGit(args, { cwd: repoRoot });
    const rawOutput = result.stdout;

    if (!rawOutput || !rawOutput.trim()) {
      return [];
    }

    const records: GitCommitRecord[] = [];
    const chunks = rawOutput.split(RECORD_DELIMITER);

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const fields = chunk.split(FIELD_DELIMITER);
      if (fields.length < 5) continue;

      const hash = fields[0].trim();
      if (!hash) continue;

      const parentsRaw = fields[1].trim();
      const parents = parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [];

      const authorDate = fields[2].trim() || undefined;
      const subject = fields[3].trim();
      const bodyRaw = fields[4];
      const body = bodyRaw?.trim() ? bodyRaw.trim() : undefined;

      let files: string[] | undefined;
      if (withFiles && fields.length >= 6) {
        const fileLines = fields[5].split(/\r?\n/);
        files = fileLines.map((l) => l.trim()).filter((l) => l.length > 0);
      }

      const isMerge = parents.length > 1;
      if (!includeMerges && isMerge) {
        continue;
      }

      records.push({
        hash,
        parents,
        authorDate,
        subject,
        body,
        files,
      });
    }

    return records;
  } catch (err: any) {
    // If revision does not exist or repository is empty, return empty array
    if (
      err.message?.includes("does not have any commits") ||
      err.message?.includes("ambiguous argument 'HEAD'")
    ) {
      return [];
    }
    throw err;
  }
}

/**
 * Retrieves comprehensive details for a specific commit-ish (HEAD, HEAD~1, SHA)
 * including full commit message, structured record, changed files, and unified patch.
 */
export async function getCommitDetails(
  repoRoot: string,
  commitIsh: string,
): Promise<CommitDetails | null> {
  try {
    // 1. Get commit record and raw body
    // %H = hash, %P = parent hashes, %aI = author date, %s = subject, %B = raw body
    const logRes = await runGit(
      [
        "log",
        "-1",
        `--format=%H${FIELD_DELIMITER}%P${FIELD_DELIMITER}%aI${FIELD_DELIMITER}%s${FIELD_DELIMITER}%B`,
        commitIsh,
      ],
      { cwd: repoRoot },
    );

    const parts = logRes.stdout.split(FIELD_DELIMITER);
    if (parts.length < 4) {
      return null;
    }

    const hash = parts[0]?.trim() || "";
    const parentList = parts[1]?.trim() || "";
    const authorDate = parts[2]?.trim();
    const subject = parts[3]?.trim() || "";
    const fullMessage = (parts.slice(4).join(FIELD_DELIMITER) || "").trim();

    // Body is message without subject
    let body = "";
    if (fullMessage.startsWith(subject)) {
      body = fullMessage.slice(subject.length).trim();
    } else {
      body = fullMessage;
    }

    // 2. Get changed files
    const showFilesRes = await runGit(["show", "--name-status", "-z", "--format=", commitIsh], {
      cwd: repoRoot,
    });
    const { parseNameStatusZ } = await import("./staged.js");
    const rawChanges = parseNameStatusZ(showFilesRes.stdout);
    const changedFiles: GitFileChange[] = rawChanges.map((c) => ({
      path: c.path,
      previousPath: c.previousPath,
      status: c.status,
      binary: false,
    }));

    // 3. Get unified patch
    const patchRes = await runGit(["show", "--patch", "--format=", commitIsh], { cwd: repoRoot });

    const record: GitCommitRecord = {
      hash,
      parents: parentList ? parentList.split(/\s+/) : [],
      authorDate,
      subject,
      body: body || undefined,
      files: changedFiles.map((f) => f.path),
    };

    return {
      record,
      message: fullMessage || subject,
      subject,
      body,
      changedFiles,
      patch: patchRes.stdout,
    };
  } catch {
    return null;
  }
}
