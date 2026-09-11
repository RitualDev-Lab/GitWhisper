import path from "node:path";
import type { HunkIntelligence } from "../intelligence/hunk-intelligence.js";
import type { FilePatch, PatchHunk } from "../patch/types.js";
import type { HunkRelationship } from "./hunk-relationships.js";
import type { PlanOptions } from "./types.js";

export interface HunkFileChange {
  file: string;
  hunkIds: string[];
  wholeFile: boolean;
}

export interface HunkCommitGroup {
  id: string;
  name: string;
  concern: string;
  hunkIds: string[];
  fileChanges: HunkFileChange[];
  relationships: HunkRelationship[];
  confidence: number;
}

/**
 * Derives a readable concern title for a cluster of hunks.
 */
function deriveHunkGroupName(
  hunkIds: string[],
  hunkMap: Map<string, { hunk: PatchHunk; intel: HunkIntelligence; file: FilePatch }>,
  groupIndex: number,
): { name: string; concern: string } {
  const items = hunkIds.map((id) => hunkMap.get(id)).filter(Boolean) as Array<{
    hunk: PatchHunk;
    intel: HunkIntelligence;
    file: FilePatch;
  }>;

  if (items.length === 0) {
    return {
      name: `Group ${groupIndex + 1}`,
      concern: "Miscellaneous changes",
    };
  }

  // Check symbols
  const allSymbols = items.flatMap((i) => [
    ...(i.intel.enclosingSymbol ? [i.intel.enclosingSymbol] : []),
    ...i.intel.changedSymbols,
  ]);
  const primarySymbol = allSymbols[0];

  // Check scopes
  const scopes = items.map((i) => i.intel.probableScope).filter(Boolean) as string[];
  const primaryScope = scopes[0];

  // If there's a strong symbol
  if (primarySymbol) {
    const capitalizedSym = primarySymbol.charAt(0).toUpperCase() + primarySymbol.slice(1);
    if (primaryScope && primaryScope.toLowerCase() !== primarySymbol.toLowerCase()) {
      return {
        name: `${capitalizedSym} (${primaryScope})`,
        concern: `Updates to ${primarySymbol} in ${primaryScope}`,
      };
    }
    return {
      name: `${capitalizedSym} changes`,
      concern: `Updates to ${primarySymbol}`,
    };
  }

  if (primaryScope) {
    const capScope = primaryScope.charAt(0).toUpperCase() + primaryScope.slice(1);
    return {
      name: `${capScope} updates`,
      concern: `Changes across ${primaryScope}`,
    };
  }

  // Single file fallback
  const firstFile = items[0].file.newPath || items[0].file.oldPath || "file";
  const base = path.posix.basename(firstFile);
  return {
    name: `${base} [${items.length} hunk${items.length > 1 ? "s" : ""}]`,
    concern: `Updates in ${base}`,
  };
}

/**
 * Clusters hunks into connected components based on the relationship graph.
 */
export function clusterHunks(
  hunksWithIntel: Array<{ hunk: PatchHunk; intel: HunkIntelligence; file: FilePatch }>,
  relationships: HunkRelationship[],
  options?: PlanOptions,
): {
  groups: HunkCommitGroup[];
  cohesionScore: number;
} {
  let minConfidence = 0.6;
  if (typeof options?.minimumConfidence === "number") {
    minConfidence = options.minimumConfidence;
  } else if (options?.minimumConfidence === "high") {
    minConfidence = 0.8;
  } else if (options?.minimumConfidence === "medium") {
    minConfidence = 0.6;
  } else if (options?.minimumConfidence === "low") {
    minConfidence = 0.4;
  }

  const validEdges = relationships.filter((r) => r.confidence >= minConfidence);

  const adj = new Map<string, Set<string>>();
  const hunkMap = new Map<string, { hunk: PatchHunk; intel: HunkIntelligence; file: FilePatch }>();

  for (const item of hunksWithIntel) {
    adj.set(item.hunk.id, new Set());
    hunkMap.set(item.hunk.id, item);
  }

  for (const edge of validEdges) {
    if (adj.has(edge.sourceHunkId) && adj.has(edge.targetHunkId)) {
      adj.get(edge.sourceHunkId)?.add(edge.targetHunkId);
      adj.get(edge.targetHunkId)?.add(edge.sourceHunkId);
    }
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const item of hunksWithIntel) {
    const id = item.hunk.id;
    if (visited.has(id)) continue;

    const component: string[] = [];
    const queue: string[] = [id];
    visited.add(id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const neighbors = adj.get(current) || new Set();
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    components.push(component);
  }

  // Build groups
  const groups: HunkCommitGroup[] = components.map((hunkIds, idx) => {
    const { name, concern } = deriveHunkGroupName(hunkIds, hunkMap, idx);

    // Group hunks by file
    const fileToHunks = new Map<string, string[]>();
    for (const hId of hunkIds) {
      const item = hunkMap.get(hId);
      if (item) {
        const filePath = item.file.newPath || item.file.oldPath || "unknown";
        if (!fileToHunks.has(filePath)) {
          fileToHunks.set(filePath, []);
        }
        fileToHunks.get(filePath)?.push(hId);
      }
    }

    const fileChanges: HunkFileChange[] = [];
    for (const [filePath, fHunkIds] of fileToHunks.entries()) {
      const filePatch = hunksWithIntel.find(
        (i) => (i.file.newPath || i.file.oldPath) === filePath,
      )?.file;
      const wholeFile = Boolean(filePatch && fHunkIds.length === filePatch.hunks.length);
      fileChanges.push({
        file: filePath,
        hunkIds: fHunkIds,
        wholeFile,
      });
    }

    const groupRels = relationships.filter(
      (r) => hunkIds.includes(r.sourceHunkId) && hunkIds.includes(r.targetHunkId),
    );

    const confidence =
      groupRels.length > 0
        ? groupRels.reduce((acc, r) => acc + r.confidence, 0) / groupRels.length
        : 0.9;

    return {
      id: `g${idx + 1}`,
      name,
      concern,
      hunkIds,
      fileChanges,
      relationships: groupRels,
      confidence: Number(confidence.toFixed(2)),
    };
  });

  const cohesionScore = groups.length > 1 ? Number((1 / groups.length).toFixed(2)) : 1.0;

  return {
    groups,
    cohesionScore,
  };
}
