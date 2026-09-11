import { GitError, runGit } from "./executor.js";
import type { GitCommitResult } from "./types.js";

export interface CommitMessage {
  subject: string;
  body?: string;
}

export class CommitHookFailedError extends Error {
  readonly hookType: "pre-commit" | "commit-msg" | "unknown";
  readonly details: string;

  constructor(hookType: "pre-commit" | "commit-msg" | "unknown", details: string) {
    super(`Git hook failed (${hookType}):\n${details}`);
    this.name = "CommitHookFailedError";
    this.hookType = hookType;
    this.details = details;
  }
}

/**
 * Commits staged changes with the approved subject and optional body.
 * Runs git commit with direct process arguments (no shell interpolation).
 * Returns the real Git short commit hash and git commit stdout.
 */
export async function commitStagedChanges(
  repoRoot: string,
  message: CommitMessage,
): Promise<GitCommitResult> {
  const subject = message.subject.trim();
  if (!subject) {
    throw new Error("Commit subject cannot be empty.");
  }

  const args = ["commit", "-m", subject];

  if (message.body && message.body.trim().length > 0) {
    args.push("-m", message.body.trim());
  }

  let commitOutput: string;
  try {
    const result = await runGit(args, { cwd: repoRoot });
    commitOutput = result.stdout;
  } catch (err: any) {
    if (err instanceof GitError) {
      const stderr = err.stderr.toLowerCase();
      const stdout = err.stdout.toLowerCase();
      const combined = `${stderr}\n${stdout}`;

      if (combined.includes("pre-commit hook failed") || combined.includes("hook declined")) {
        throw new CommitHookFailedError("pre-commit", err.stderr || err.stdout);
      }
      if (combined.includes("commit-msg hook failed")) {
        throw new CommitHookFailedError("commit-msg", err.stderr || err.stdout);
      }
    }
    throw err;
  }

  // Authoritatively fetch the short commit hash created by Git
  const hashResult = await runGit(["rev-parse", "--short", "HEAD"], { cwd: repoRoot });
  const commitHash = hashResult.stdout.trim();

  return {
    commitHash,
    fullOutput: commitOutput,
  };
}
