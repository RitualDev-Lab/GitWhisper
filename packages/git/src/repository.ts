import path from "node:path";
import { GitError, NotAGitRepositoryError, runGit } from "./executor.js";
import type { GitRemote, GitRepository, GitRunOptions } from "./types.js";

/**
 * Searches for a Git repository starting from the given directory.
 * Returns the absolute repository root path, or null if not in a repository.
 */
export async function findRepository(cwd?: string): Promise<string | null> {
  try {
    return await getRepositoryRoot(cwd);
  } catch (err) {
    if (err instanceof NotAGitRepositoryError) {
      return null;
    }
    throw err;
  }
}

/**
 * Gets the repository root path. Throws NotAGitRepositoryError if not inside a Git repository.
 */
export async function getRepositoryRoot(cwd?: string): Promise<string> {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  const root = result.stdout.trim();
  // Normalize Windows paths if needed
  return path.normalize(root);
}

/**
 * Sanitizes a remote URL by stripping embedded user credentials.
 */
export function sanitizeRemoteUrl(url: string): string {
  try {
    if (url.includes("://") && url.includes("@")) {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Parses Git remote URL into host, owner, repository, and provider hint.
 */
export function parseRemoteDetails(name: string, rawUrl: string): GitRemote {
  const url = sanitizeRemoteUrl(rawUrl);
  let host: string | undefined;
  let owner: string | undefined;
  let repository: string | undefined;
  let provider: GitRemote["provider"] = "generic";

  const sshScpMatch = rawUrl.match(/^git@([^:]+):([^/]+)\/(.+?)(\.git)?$/);
  if (sshScpMatch) {
    host = sshScpMatch[1];
    owner = sshScpMatch[2];
    repository = sshScpMatch[3];
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      const parts = parsed.pathname
        .replace(/^\//, "")
        .replace(/\.git$/, "")
        .split("/");
      if (parts.length >= 2) {
        owner = parts[0];
        repository = parts.slice(1).join("/");
      }
    } catch {
      // Fallback
    }
  }

  if (host) {
    if (host.includes("github.com")) provider = "github";
    else if (host.includes("gitlab.com") || host.includes("gitlab.")) provider = "gitlab";
    else if (host.includes("bitbucket.org")) provider = "bitbucket";
  }

  return {
    name,
    url,
    host,
    owner,
    repository,
    provider,
  };
}

/**
 * Gets the configured Git remotes with sanitized URLs and structured metadata.
 */
export async function getGitRemotes(repoRoot: string): Promise<GitRemote[]> {
  try {
    const result = await runGit(["remote", "-v"], { cwd: repoRoot });
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const remotes: GitRemote[] = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const name = parts[0];
        const rawUrl = parts[1];
        if (!seen.has(name)) {
          seen.add(name);
          remotes.push(parseRemoteDetails(name, rawUrl));
        }
      }
    }
    return remotes;
  } catch {
    return [];
  }
}

/**
 * Gets the name of the current branch, or null / description if HEAD is detached.
 */
export async function getCurrentBranch(repoRoot: string): Promise<string | null> {
  try {
    const result = await runGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd: repoRoot });
    const branch = result.stdout.trim();
    return branch || null;
  } catch {
    // Check if detached HEAD
    try {
      const headResult = await runGit(["rev-parse", "--short", "HEAD"], { cwd: repoRoot });
      const hash = headResult.stdout.trim();
      return hash ? `(detached at ${hash})` : null;
    } catch {
      // Repository has no commits yet (initial state)
      return null;
    }
  }
}

/**
 * Gets the commit hash of HEAD, or null if repository has no commits yet.
 */
export async function getHeadCommit(repoRoot: string): Promise<string | null> {
  try {
    const result = await runGit(["rev-parse", "HEAD"], { cwd: repoRoot });
    const hash = result.stdout.trim();
    return hash || null;
  } catch {
    // 0 commits
    return null;
  }
}

/**
 * Gathers complete repository metadata.
 */
export async function getRepositoryInfo(cwd?: string): Promise<GitRepository> {
  const root = await getRepositoryRoot(cwd);
  const name = path.basename(root);
  const head = await getHeadCommit(root);
  const branch = await getCurrentBranch(root);
  const isDetachedHead = branch?.startsWith("(detached") ?? false;
  const remotes = await getGitRemotes(root);

  return {
    root,
    name,
    branch,
    head,
    isInitial: head === null,
    isDetachedHead,
    remotes,
  };
}
