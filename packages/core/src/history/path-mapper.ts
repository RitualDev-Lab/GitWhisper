import path from "node:path";
import type { GitCommitRecord } from "@gitwhisper/git";
import type { ConfidenceLevel } from "../intelligence/types.js";
import type { HistoricalScopeMapping } from "./types.js";

interface ScopePathStats {
  prefix: string;
  scopeCounts: Map<string, number>;
  total: number;
}

/**
 * Extracts top-level directory prefix for correlation (e.g. "packages/auth" or "src/editor").
 */
function extractPathPrefix(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts.length <= 1) {
    return null; // Root file
  }

  // If in packages/* or apps/* or modules/*, take 2 segments (e.g. packages/auth)
  if (["packages", "apps", "modules", "libs", "services"].includes(parts[0]) && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`;
  }

  // Otherwise take top directory (e.g. src or docs) or top 2 if src/sub
  if (parts[0] === "src" && parts.length > 2) {
    return `src/${parts[1]}`;
  }

  return parts[0];
}

/**
 * Builds deterministic path-to-scope evidence from historical commits that contain both scope and files.
 */
export function buildHistoricalScopeMappings(commits: GitCommitRecord[]): HistoricalScopeMapping[] {
  const prefixMap = new Map<string, ScopePathStats>();

  const scopeRegex = /^[a-zA-Z0-9_-]+\(([^)]+)\)!?:\s*(.+)$/;

  for (const commit of commits) {
    if (!commit.files || commit.files.length === 0) continue;

    const match = commit.subject.match(scopeRegex);
    if (!match) continue;

    const scope = match[1].trim().toLowerCase();
    if (!scope) continue;

    const seenPrefixes = new Set<string>();
    for (const f of commit.files) {
      const prefix = extractPathPrefix(f);
      if (prefix && !seenPrefixes.has(prefix)) {
        seenPrefixes.add(prefix);

        let stats = prefixMap.get(prefix);
        if (!stats) {
          stats = { prefix, scopeCounts: new Map(), total: 0 };
          prefixMap.set(prefix, stats);
        }

        stats.total += 1;
        stats.scopeCounts.set(scope, (stats.scopeCounts.get(scope) ?? 0) + 1);
      }
    }
  }

  const mappings: HistoricalScopeMapping[] = [];

  for (const [prefix, stats] of prefixMap.entries()) {
    // Find dominant scope for this prefix
    let dominantScope = "";
    let maxCount = 0;

    for (const [scope, count] of stats.scopeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantScope = scope;
      }
    }

    if (!dominantScope) continue;

    const consistency = maxCount / stats.total;
    let confidence: ConfidenceLevel;

    if (maxCount >= 3 && consistency >= 0.75) {
      confidence = "HIGH";
    } else if (maxCount >= 2 && consistency >= 0.6) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }

    mappings.push({
      pathPrefix: prefix,
      scope: dominantScope,
      observations: maxCount,
      confidence,
    });
  }

  // Sort by observations desc
  return mappings.sort((a, b) => b.observations - a.observations);
}
