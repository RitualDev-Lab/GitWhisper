import { findRepository } from "@gitwhisper/git";
import { GitWhisperClientImpl } from "./client.js";
import { GitWhisperError } from "./errors.js";
import type { GitWhisperClient, GitWhisperOptions } from "./types.js";

/**
 * Creates and initializes a headless GitWhisper engine client for the specified repository.
 * Safe for IDEs, background workers, and automation pipelines.
 */
export async function createGitWhisper(options: GitWhisperOptions): Promise<GitWhisperClient> {
  if (!options?.repository) {
    throw new GitWhisperError({
      code: "NOT_A_GIT_REPOSITORY",
      message: "A repository path must be provided to createGitWhisper.",
    });
  }

  const root = await findRepository(options.repository);
  if (!root) {
    throw new GitWhisperError({
      code: "NOT_A_GIT_REPOSITORY",
      message: `Repository path "${options.repository}" is not inside a Git repository.`,
    });
  }

  return new GitWhisperClientImpl({
    ...options,
    repository: root,
  });
}
