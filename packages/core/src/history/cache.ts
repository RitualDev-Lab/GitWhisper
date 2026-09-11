import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RepositoryCommitStyle } from "./types.js";

/**
 * Returns the directory used for GitWhisper cache files.
 */
export function getHistoryCacheDir(): string {
  const isWindows = process.platform === "win32";
  const baseDir =
    isWindows && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "gitwhisper", "cache")
      : path.join(os.homedir(), ".cache", "gitwhisper", "history-profiles");

  return baseDir;
}

/**
 * Computes a deterministic cache key for a repository's history profile.
 */
export function computeHistoryCacheKey(
  repoRoot: string,
  headCommit: string | null,
  optionsKey: string,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`${repoRoot}:${headCommit ?? "initial"}:${optionsKey}`);
  return hash.digest("hex");
}

/**
 * Reads cached history profile if present and valid.
 */
export async function getCachedHistoryProfile(
  cacheKey: string,
): Promise<RepositoryCommitStyle | null> {
  try {
    const dir = getHistoryCacheDir();
    const filePath = path.join(dir, `${cacheKey}.json`);
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data) as RepositoryCommitStyle;
  } catch {
    return null;
  }
}

/**
 * Saves a history profile to the user cache directory.
 */
export async function setCachedHistoryProfile(
  cacheKey: string,
  profile: RepositoryCommitStyle,
): Promise<void> {
  try {
    const dir = getHistoryCacheDir();
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${cacheKey}.json`);
    await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf8");
  } catch {
    // Non-critical: caching failures should never abort the execution
  }
}
