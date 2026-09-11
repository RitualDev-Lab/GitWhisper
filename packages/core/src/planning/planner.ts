import crypto from "node:crypto";
import { getIndexFingerprint, hasMergeConflicts } from "@gitwhisper/git";
import type { ChangeContext } from "../types.js";
import { detectScopeCandidates } from "../intelligence/scope-detector.js";
import { detectTypeCandidates } from "../intelligence/type-detector.js";
import type { CommitProposal } from "../intelligence/types.js";
import { clusterChanges } from "./clustering.js";
import { discoverRelationships } from "./relationships.js";
import type { CommitGroup, CommitPlan, PlanOptions } from "./types.js";

/**
 * Validates strict invariants on a CommitPlan before returning or executing.
 */
export function validateCommitPlanInvariants(plan: CommitPlan, stagedFiles: string[]): void {
  const stagedSet = new Set(stagedFiles);
  const seenFiles = new Set<string>();

  for (const group of plan.groups) {
    if (group.files.length === 0) {
      throw new Error(`Group ${group.id} contains 0 files.`);
    }
    for (const file of group.files) {
      if (!stagedSet.has(file)) {
        throw new Error(
          `Group ${group.id} contains file '${file}' which is not in staged changes.`,
        );
      }
      if (seenFiles.has(file)) {
        throw new Error(`File '${file}' is assigned to multiple groups in commit plan.`);
      }
      seenFiles.add(file);
    }
  }

  for (const stagedFile of stagedFiles) {
    if (!seenFiles.has(stagedFile)) {
      throw new Error(`Staged file '${stagedFile}' is missing from commit plan groups.`);
    }
  }
}

/**
 * Builds a deterministic initial proposal for a group of files.
 */
export function buildGroupProposal(group: CommitGroup, context: ChangeContext): CommitProposal {
  const groupFileSet = new Set(group.files);
  const groupClassified = context.files.filter((f) => groupFileSet.has(f.path));

  const { candidates: types, signals } = detectTypeCandidates(groupClassified, "");
  const scopes = detectScopeCandidates(groupClassified);

  const topType = types[0] ?? {
    type: "chore",
    confidence: "LOW" as const,
    reasons: [],
  };
  const topScope = scopes[0];

  // Description formatting
  let desc = group.concern.toLowerCase();
  if (desc.startsWith("update ") || desc.startsWith("changes in ")) {
    desc = desc.replace(/^(update|changes in)\s+/, "");
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
 * Builds a comprehensive CommitPlan from the staged repository changes.
 */
export async function buildCommitPlan(
  repoRoot: string,
  context: ChangeContext,
  options?: PlanOptions,
): Promise<CommitPlan> {
  // Check for merge conflicts
  const hasConflicts = await hasMergeConflicts(repoRoot);
  if (hasConflicts) {
    throw new Error("Cannot build commit plan: repository has unmerged merge conflicts.");
  }

  // Get index fingerprint
  const fingerprint = await getIndexFingerprint(repoRoot);

  const stagedFilePaths = context.files.map((f) => f.path);

  if (stagedFilePaths.length === 0) {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      indexFingerprint: fingerprint,
      totalFiles: 0,
      isSingleConcern: true,
      cohesionScore: 1.0,
      groups: [],
      relationships: [],
      warnings: ["No files staged for commit."],
    };
  }

  // 1. Discover relationships
  const relationships = discoverRelationships(context.files, context.patch);

  // 2. Cluster files into concern groups
  const { groups, cohesionScore } = clusterChanges(context.files, relationships, options);

  // 3. Attach proposals to each group
  for (const group of groups) {
    group.proposal = buildGroupProposal(group, context);
  }

  const isSingleConcern = groups.length <= 1;
  const warnings: string[] = [];

  if (!isSingleConcern) {
    warnings.push(
      `Detected ${groups.length} distinct concerns across ${stagedFilePaths.length} staged files.`,
    );
  }

  const plan: CommitPlan = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    indexFingerprint: fingerprint,
    totalFiles: stagedFilePaths.length,
    isSingleConcern,
    cohesionScore,
    groups,
    relationships,
    warnings,
  };

  // 4. Validate release-blocking invariants
  validateCommitPlanInvariants(plan, stagedFilePaths);

  return plan;
}
