import path from "node:path";
import type { ClassifiedFileChange } from "../types.js";
import type { ConfidenceLevel, ScopeCandidate } from "./types.js";

const GENERIC_DIRECTORIES = new Set([
  "src",
  "source",
  "lib",
  "packages",
  "apps",
  "app",
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "pkg",
  "dist",
  "bin",
  "build",
  "internal",
  "core", // only when at top-level generic
]);

export interface ScopeDetectorOptions {
  configuredScopes?: string[];
  strictScopes?: boolean;
}

function scoreToConfidence(score: number): ConfidenceLevel {
  if (score >= 0.85) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  return "LOW";
}

/**
 * Extracts a meaningful domain or feature scope from a file path.
 * Skips generic top-level containers like `src`, `packages`, `apps`.
 */
export function extractScopeFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s.length > 0);

  // Check monorepo packages/apps structure
  if (segments.length >= 2) {
    if (segments[0] === "packages" || segments[0] === "apps") {
      const packageName = segments[1];
      if (packageName && !GENERIC_DIRECTORIES.has(packageName.toLowerCase())) {
        return packageName.toLowerCase();
      }
      // If segments[1] is generic (e.g. packages/core), check next meaningful segment if present
      if (segments.length >= 4 && (segments[2] === "src" || segments[2] === "lib")) {
        return segments[3].toLowerCase();
      }
      return packageName.toLowerCase();
    }
  }

  // Traverse segments, finding the first non-generic directory
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i].toLowerCase();
    if (!GENERIC_DIRECTORIES.has(seg)) {
      return seg;
    }
  }

  return null;
}

/**
 * Deterministically infers ranked scope candidates from staged repository file paths.
 */
export function detectScopeCandidates(
  files: ClassifiedFileChange[],
  options: ScopeDetectorOptions = {},
): ScopeCandidate[] {
  if (files.length === 0) {
    return [{ scope: "none", score: 0.1, reasons: ["No files staged"], confidence: "LOW" }];
  }

  const { configuredScopes = [], strictScopes = false } = options;
  const scopeCounts = new Map<string, { count: number; paths: string[] }>();

  // Check if all changes are dependencies
  const allDeps = files.every((f) => f.category === "dependency");
  if (allDeps) {
    const candidate: ScopeCandidate = {
      scope: "deps",
      score: 0.95,
      reasons: ["All staged changes modify dependency manifests or lockfiles"],
      confidence: "HIGH",
    };
    return [candidate];
  }

  // Check if all changes are CI
  const allCi = files.every((f) => f.path.startsWith(".github/") || f.path.includes("ci"));
  if (allCi) {
    return [
      {
        scope: "ci",
        score: 0.9,
        reasons: ["Continuous integration configuration changes"],
        confidence: "HIGH",
      },
      {
        scope: "none",
        score: 0.3,
        reasons: ["Scope optional for global CI updates"],
        confidence: "LOW",
      },
    ];
  }

  for (const f of files) {
    const scope = extractScopeFromPath(f.path);
    if (scope) {
      const entry = scopeCounts.get(scope) || { count: 0, paths: [] };
      entry.count++;
      entry.paths.push(f.path);
      scopeCounts.set(scope, entry);
    }
  }

  const candidates: ScopeCandidate[] = [];

  for (const [scope, data] of scopeCounts.entries()) {
    const ratio = data.count / files.length;
    let score = Number((ratio * 0.9).toFixed(2));

    const reasons: string[] = [
      `${data.count} of ${files.length} staged file(s) are located in "${scope}"`,
    ];

    if (configuredScopes.map((s) => s.toLowerCase()).includes(scope.toLowerCase())) {
      score = Math.min(1.0, score + 0.15);
      reasons.push(`Matches configured repository scope "${scope}"`);
    }

    candidates.push({
      scope,
      score,
      reasons,
      confidence: scoreToConfidence(score),
    });
  }

  // If configured scopes are defined, also check if any match paths
  for (const confScope of configuredScopes) {
    const exists = candidates.some((c) => c.scope.toLowerCase() === confScope.toLowerCase());
    if (!exists) {
      const matchCount = files.filter((f) =>
        f.path.toLowerCase().includes(confScope.toLowerCase()),
      ).length;
      if (matchCount > 0) {
        const score = Number(((matchCount / files.length) * 0.85).toFixed(2));
        candidates.push({
          scope: confScope,
          score,
          reasons: [`Matches configured scope "${confScope}" referenced in file paths`],
          confidence: scoreToConfidence(score),
        });
      }
    }
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);

  // If strict scopes is enabled, keep only configured scopes
  let filteredCandidates = candidates;
  if (strictScopes && configuredScopes.length > 0) {
    const allowed = new Set(configuredScopes.map((s) => s.toLowerCase()));
    filteredCandidates = candidates.filter((c) => allowed.has(c.scope.toLowerCase()));
  }

  // Always offer "none" as a fallback candidate
  const topScore = filteredCandidates[0]?.score ?? 0;
  filteredCandidates.push({
    scope: "none",
    score: topScore >= 0.8 ? 0.2 : 0.6,
    reasons: ["Omit scope for cross-cutting or repository-wide changes"],
    confidence: topScore >= 0.8 ? "LOW" : "MEDIUM",
  });

  return filteredCandidates;
}
