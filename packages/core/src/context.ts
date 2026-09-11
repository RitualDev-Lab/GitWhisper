import path from "node:path";
import { getRepositoryInfo, getStagedDiff, getStagedFiles, getStagedStats } from "@gitwhisper/git";
import { classifyFileChange } from "./classifier.js";
import { guardDiff } from "./diff-guard.js";
import { detectScopeCandidates } from "./intelligence/scope-detector.js";
import {
  detectTypeCandidates,
  isBuildFile,
  isCiFile,
  summarizeCategories,
} from "./intelligence/type-detector.js";
import type { ChangeIntelligence } from "./intelligence/types.js";
import type { ChangeCharacteristics, ChangeContext, DiffGuardOptions } from "./types.js";

export interface BuildContextOptions extends DiffGuardOptions {
  configuredScopes?: string[];
  strictScopes?: boolean;
}

/**
 * Builds a structured ChangeContext from real staged Git repository changes,
 * augmented with deterministic Conventional Commit intelligence.
 */
export async function buildChangeContext(
  repoRoot: string,
  options: BuildContextOptions = {},
): Promise<ChangeContext> {
  const [repoInfo, rawFiles, stats, rawDiff] = await Promise.all([
    getRepositoryInfo(repoRoot),
    getStagedFiles(repoRoot),
    getStagedStats(repoRoot),
    getStagedDiff(repoRoot),
  ]);

  const files = rawFiles.map(classifyFileChange);
  const { sanitizedPatch, metadata } = guardDiff(rawDiff, files, options);

  const characteristics: ChangeCharacteristics = {
    hasTests: files.some((f) => f.category === "test"),
    hasDocumentation: files.some((f) => f.category === "documentation"),
    hasConfiguration: files.some((f) => f.category === "configuration"),
    hasDependencies: files.some((f) => f.category === "dependency"),
    hasBinaryChanges: files.some((f) => f.category === "binary" || f.binary),
  };

  // Deterministic Intelligence Analysis
  const fileCategories = summarizeCategories(files);
  const { candidates: probableTypes, signals } = detectTypeCandidates(files, rawDiff);
  const probableScopes = detectScopeCandidates(files, {
    configuredScopes: options.configuredScopes,
    strictScopes: options.strictScopes,
  });

  const affectedDirsSet = new Set<string>();
  for (const f of files) {
    const dir = path.dirname(f.path).replace(/\\/g, "/");
    if (dir && dir !== ".") {
      affectedDirsSet.add(dir);
    }
  }

  const intelligence: ChangeIntelligence = {
    fileCategories,
    affectedDirectories: Array.from(affectedDirsSet),
    packageChanges: [],
    configChanges: files.filter((f) => f.category === "configuration").map((f) => f.path),
    testChanges: files.filter((f) => f.category === "test").map((f) => f.path),
    documentationChanges: files.filter((f) => f.category === "documentation").map((f) => f.path),
    sourceChanges: files.filter((f) => f.category === "source").map((f) => f.path),
    ciChanges: files.filter((f) => isCiFile(f.path)).map((f) => f.path),
    buildChanges: files.filter((f) => isBuildFile(f.path)).map((f) => f.path),
    probableScopes,
    probableTypes,
    signals,
  };

  return {
    repository: {
      root: repoInfo.root,
      name: repoInfo.name,
      branch: repoInfo.branch,
      head: repoInfo.head,
      isInitial: repoInfo.isInitial,
    },
    files,
    stats,
    patch: sanitizedPatch,
    diffMetadata: metadata,
    characteristics,
    intelligence,
  };
}
