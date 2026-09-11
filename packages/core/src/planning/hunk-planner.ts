import crypto from "node:crypto";
import { getIndexFingerprint, hasMergeConflicts } from "@gitwhisper/git";
import type { ChangeContext } from "../types.js";
import { detectTypeCandidates } from "../intelligence/type-detector.js";
import { detectScopeCandidates } from "../intelligence/scope-detector.js";
import type { CommitProposal } from "../intelligence/types.js";
import { parsePatch } from "../patch/parser.js";
import type { GitPatch, PatchHunk, FilePatch } from "../patch/types.js";
import {
  analyzeHunkIntelligence,
  type HunkIntelligence,
} from "../intelligence/hunk-intelligence.js";
import { discoverHunkRelationships, type HunkRelationship } from "./hunk-relationships.js";
import { clusterHunks, type HunkCommitGroup } from "./hunk-clustering.js";
import type { PlanOptions } from "./types.js";

export interface HunkCommitPlan {
  id: string;
  timestamp: string;
  granularity: "file" | "hunk" | "mixed";
  indexFingerprint: string;
  totalFiles: number;
  totalHunks: number;
  isSingleConcern: boolean;
  cohesionScore: number;
  groups: Array<HunkCommitGroup & { proposal?: CommitProposal }>;
  relationships: HunkRelationship[];
  patch: GitPatch;
  warnings: string[];
}

/**
 * Validates release-blocking invariants for hunk-level commit plans.
 */
export function validateHunkPlanInvariants(plan: HunkCommitPlan, allStagedHunkIds: string[]): void {
  const stagedSet = new Set(allStagedHunkIds);
  const assignedSet = new Set<string>();

  for (const group of plan.groups) {
    if (group.hunkIds.length === 0) {
      throw new Error(`Group ${group.id} contains 0 hunks.`);
    }

    for (const hId of group.hunkIds) {
      if (!stagedSet.has(hId)) {
        throw new Error(`Group ${group.id} contains unknown/unstaged hunk ID '${hId}'.`);
      }
      if (assignedSet.has(hId)) {
        throw new Error(`Hunk '${hId}' is assigned to multiple groups in commit plan.`);
      }
      assignedSet.add(hId);
    }
  }

  for (const hId of allStagedHunkIds) {
    if (!assignedSet.has(hId)) {
      throw new Error(`Staged hunk '${hId}' is missing from commit plan groups.`);
    }
  }
}

/**
 * Builds proposal for a hunk group.
 */
function buildHunkGroupProposal(group: HunkCommitGroup, context: ChangeContext): CommitProposal {
  const groupFilePaths = new Set(group.fileChanges.map((f) => f.file));
  const groupFiles = context.files.filter((f) => groupFilePaths.has(f.path));

  const { candidates: types, signals } = detectTypeCandidates(groupFiles, "");
  const scopes = detectScopeCandidates(groupFiles);

  const topType = types[0] ?? {
    type: "chore",
    confidence: "LOW" as const,
    reasons: [],
  };
  const topScope = scopes[0];

  let desc = group.concern.toLowerCase();
  if (desc.startsWith("updates to ") || desc.startsWith("changes across ")) {
    desc = desc.replace(/^(updates to|changes across)\s+/, "");
  }

  return {
    type: topType.type,
    scope: topScope?.scope,
    description: desc,
    breaking: false,
    confidence: {
      type: topType.confidence,
      scope: topScope ? topScope.confidence : "LOW",
    },
    evidence: {
      typeReasons: topType.reasons,
      scopeReasons: topScope ? topScope.reasons : [],
      signals,
    },
  };
}

/**
 * Builds a structured HunkCommitPlan from staged repository diff.
 */
export async function buildHunkCommitPlan(
  repoRoot: string,
  context: ChangeContext,
  options?: PlanOptions & { level?: "file" | "hunk" | "auto" },
): Promise<HunkCommitPlan> {
  const hasConflicts = await hasMergeConflicts(repoRoot);
  if (hasConflicts) {
    throw new Error("Cannot build commit plan: repository has unmerged merge conflicts.");
  }

  const fingerprint = await getIndexFingerprint(repoRoot);
  const patch = parsePatch(context.patch, fingerprint);

  const allHunksWithIntel: Array<{
    hunk: PatchHunk;
    intel: HunkIntelligence;
    file: FilePatch;
  }> = [];

  for (const file of patch.files) {
    for (const hunk of file.hunks) {
      const intel = analyzeHunkIntelligence(hunk, file);
      allHunksWithIntel.push({ hunk, intel, file });
    }
  }

  const allStagedHunkIds = allHunksWithIntel.map((i) => i.hunk.id);

  if (allStagedHunkIds.length === 0) {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      granularity: "file",
      indexFingerprint: fingerprint,
      totalFiles: context.files.length,
      totalHunks: 0,
      isSingleConcern: true,
      cohesionScore: 1.0,
      groups: [],
      relationships: [],
      patch,
      warnings: ["No hunks found in staged changes."],
    };
  }

  // 1. Discover hunk relationships
  const relationships = discoverHunkRelationships(allHunksWithIntel);

  // 2. Cluster into groups
  const { groups, cohesionScore } = clusterHunks(allHunksWithIntel, relationships, options);

  // 3. Attach proposals to each group
  for (const group of groups) {
    (group as any).proposal = buildHunkGroupProposal(group, context);
  }

  // Determine granularity
  const hasPartialFiles = groups.some((g) => g.fileChanges.some((f) => !f.wholeFile));
  const granularity = hasPartialFiles
    ? groups.every((g) => g.fileChanges.every((f) => !f.wholeFile))
      ? "hunk"
      : "mixed"
    : "file";

  const isSingleConcern = groups.length <= 1;
  const warnings: string[] = [];

  if (!isSingleConcern) {
    warnings.push(
      `Detected ${groups.length} distinct concerns across ${allStagedHunkIds.length} staged hunks.`,
    );
  }

  const plan: HunkCommitPlan = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    granularity,
    indexFingerprint: fingerprint,
    totalFiles: patch.files.length,
    totalHunks: allStagedHunkIds.length,
    isSingleConcern,
    cohesionScore,
    groups: groups as any,
    relationships,
    patch,
    warnings,
  };

  validateHunkPlanInvariants(plan, allStagedHunkIds);
  return plan;
}
