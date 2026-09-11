import path from "node:path";
import type { ClassifiedFileChange } from "../types.js";
import type { ChangeRelationship, CommitGroup, PlanOptions } from "./types.js";

/**
 * Derives a human-readable concern name for a cluster of files.
 */
function deriveGroupName(
  files: ClassifiedFileChange[],
  groupIndex: number,
): { name: string; concern: string } {
  if (files.length === 0) {
    return {
      name: `Group ${groupIndex + 1}`,
      concern: "Miscellaneous changes",
    };
  }

  // Check if all files are dependency / lockfiles
  const allDeps = files.every((f) => f.category === "dependency");
  if (allDeps) {
    return {
      name: "Dependencies",
      concern: "Package manifests and lockfiles updates",
    };
  }

  // Check if all files are documentation
  const allDocs = files.every((f) => f.category === "documentation");
  if (allDocs) {
    const docNames = files.map((f) => path.posix.basename(f.path).replace(/\.[a-zA-Z0-9]+$/, ""));
    return {
      name: `Documentation (${docNames.slice(0, 2).join(", ")})`,
      concern: "Documentation updates",
    };
  }

  // Check common directories
  const dirs = files
    .map((f) => path.posix.dirname(f.path.replace(/\\/g, "/")))
    .filter((d) => d !== ".");

  // Count directory occurrences
  const dirCounts: Record<string, number> = {};
  for (const d of dirs) {
    // clean up generic prefixes
    const clean = d.replace(/^(src|lib|app|packages\/[^/]+\/src|tests|test)\/?/, "");
    const segs = clean.split("/").filter(Boolean);
    const primary = segs[0] || d;
    dirCounts[primary] = (dirCounts[primary] || 0) + 1;
  }

  const sortedDirs = Object.entries(dirCounts).sort((a, b) => b[1] - a[1]);
  const dominantDir = sortedDirs[0]?.[0];

  const hasTests = files.some((f) => f.category === "test");
  const hasSource = files.some((f) => f.category === "source");

  if (dominantDir) {
    const capitalized = dominantDir.charAt(0).toUpperCase() + dominantDir.slice(1);
    if (hasSource && hasTests) {
      return {
        name: `${capitalized} module and tests`,
        concern: `${capitalized} core changes with corresponding tests`,
      };
    }
    if (dominantDir === "auth" || dominantDir.includes("auth")) {
      return {
        name: "Authentication & Session",
        concern: "Auth handling and security credentials",
      };
    }
    if (dominantDir === "ui" || dominantDir.includes("component")) {
      return {
        name: "UI Components & Layout",
        concern: "User interface and presentation",
      };
    }
    return {
      name: `${capitalized} changes`,
      concern: `Changes in ${dominantDir}`,
    };
  }

  // Fallback for single file or root files
  if (files.length === 1) {
    const base = path.posix.basename(files[0].path);
    return {
      name: base,
      concern: `Update ${base}`,
    };
  }

  return {
    name: `Change Group ${groupIndex + 1}`,
    concern: `Changes across ${files.length} files`,
  };
}

/**
 * Clusters files into connected components based on relationship graph edges.
 */
export function clusterChanges(
  files: ClassifiedFileChange[],
  relationships: ChangeRelationship[],
  options?: PlanOptions,
): {
  groups: CommitGroup[];
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

  // Filter edges meeting threshold
  const validEdges = relationships.filter((r) => r.confidence >= minConfidence);

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const f of files) {
    adj.set(f.path, new Set());
  }

  for (const edge of validEdges) {
    // Only connect if both nodes are in the staged files set
    if (adj.has(edge.source) && adj.has(edge.target)) {
      adj.get(edge.source)?.add(edge.target);
      adj.get(edge.target)?.add(edge.source);
    }
  }

  // Find connected components (BFS / DFS)
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const f of files) {
    if (visited.has(f.path)) continue;

    const component: string[] = [];
    const queue: string[] = [f.path];
    visited.add(f.path);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const neighbors = adj.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  // Build groups from components
  const fileMap = new Map(files.map((f) => [f.path, f]));
  const groups: CommitGroup[] = components.map((filePaths, idx) => {
    const groupFiles = filePaths
      .map((p) => fileMap.get(p))
      .filter((f): f is ClassifiedFileChange => Boolean(f));

    const groupRels = relationships.filter(
      (r) => filePaths.includes(r.source) && filePaths.includes(r.target),
    );

    const { name, concern } = deriveGroupName(groupFiles, idx);

    // Calculate group internal confidence
    const confidence =
      groupRels.length > 0
        ? groupRels.reduce((acc, r) => acc + r.confidence, 0) / groupRels.length
        : 0.9; // Single isolated file is high confidence in its own single concern

    return {
      id: `g${idx + 1}`,
      name,
      concern,
      files: filePaths,
      relationships: groupRels,
      confidence: Number(confidence.toFixed(2)),
    };
  });

  // Calculate overall cohesion score (0 to 1.0)
  // If 1 group: cohesion is 1.0. If N groups: 1 / N, weighted by files distribution
  let cohesionScore = 1.0;
  if (groups.length > 1) {
    cohesionScore = Number((1 / groups.length).toFixed(2));
  }

  return {
    groups,
    cohesionScore,
  };
}
