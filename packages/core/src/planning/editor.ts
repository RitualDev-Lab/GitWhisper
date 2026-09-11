import type { ChangeContext } from "../types.js";
import { buildGroupProposal, validateCommitPlanInvariants } from "./planner.js";
import type { CommitGroup, CommitPlan } from "./types.js";

/**
 * Moves a file from its current group to a target group.
 */
export function moveFileBetweenGroups(
  plan: CommitPlan,
  filePath: string,
  targetGroupId: string,
  context?: ChangeContext,
): CommitPlan {
  const targetGroup = plan.groups.find((g) => g.id === targetGroupId);
  if (!targetGroup) {
    throw new Error(`Target group '${targetGroupId}' not found in commit plan.`);
  }

  const sourceGroup = plan.groups.find((g) => g.files.includes(filePath));
  if (!sourceGroup) {
    throw new Error(`File '${filePath}' not found in any group in commit plan.`);
  }

  if (sourceGroup.id === targetGroupId) {
    return plan;
  }

  // Remove from source group
  const newSourceFiles = sourceGroup.files.filter((f) => f !== filePath);
  // Add to target group
  const newTargetFiles = [...targetGroup.files, filePath];

  // Rebuild groups array
  const updatedGroups: CommitGroup[] = [];
  for (const group of plan.groups) {
    if (group.id === sourceGroup.id) {
      if (newSourceFiles.length > 0) {
        const updatedSource: CommitGroup = {
          ...group,
          files: newSourceFiles,
          relationships: plan.relationships.filter(
            (r) => newSourceFiles.includes(r.source) && newSourceFiles.includes(r.target),
          ),
        };
        if (context) {
          updatedSource.proposal = buildGroupProposal(updatedSource, context);
        }
        updatedGroups.push(updatedSource);
      }
    } else if (group.id === targetGroup.id) {
      const updatedTarget: CommitGroup = {
        ...group,
        files: newTargetFiles,
        relationships: plan.relationships.filter(
          (r) => newTargetFiles.includes(r.source) && newTargetFiles.includes(r.target),
        ),
      };
      if (context) {
        updatedTarget.proposal = buildGroupProposal(updatedTarget, context);
      }
      updatedGroups.push(updatedTarget);
    } else {
      updatedGroups.push(group);
    }
  }

  const allStagedFiles = updatedGroups.flatMap((g) => g.files);

  const updatedPlan: CommitPlan = {
    ...plan,
    groups: updatedGroups,
    isSingleConcern: updatedGroups.length <= 1,
    cohesionScore: updatedGroups.length > 1 ? Number((1 / updatedGroups.length).toFixed(2)) : 1.0,
  };

  validateCommitPlanInvariants(updatedPlan, allStagedFiles);
  return updatedPlan;
}

/**
 * Merges two groups together into one.
 */
export function mergeGroups(
  plan: CommitPlan,
  sourceGroupId: string,
  targetGroupId: string,
  context?: ChangeContext,
): CommitPlan {
  if (sourceGroupId === targetGroupId) return plan;

  const sourceGroup = plan.groups.find((g) => g.id === sourceGroupId);
  const targetGroup = plan.groups.find((g) => g.id === targetGroupId);

  if (!sourceGroup || !targetGroup) {
    throw new Error(
      `One or both groups ('${sourceGroupId}', '${targetGroupId}') not found in plan.`,
    );
  }

  const combinedFiles = [...targetGroup.files, ...sourceGroup.files];
  const combinedRels = plan.relationships.filter(
    (r) => combinedFiles.includes(r.source) && combinedFiles.includes(r.target),
  );

  const mergedTarget: CommitGroup = {
    ...targetGroup,
    name: `${targetGroup.name} & ${sourceGroup.name}`,
    concern: `${targetGroup.concern}; ${sourceGroup.concern}`,
    files: combinedFiles,
    relationships: combinedRels,
  };

  if (context) {
    mergedTarget.proposal = buildGroupProposal(mergedTarget, context);
  }

  const updatedGroups = plan.groups
    .filter((g) => g.id !== sourceGroupId)
    .map((g) => (g.id === targetGroupId ? mergedTarget : g));

  const allStagedFiles = updatedGroups.flatMap((g) => g.files);

  const updatedPlan: CommitPlan = {
    ...plan,
    groups: updatedGroups,
    isSingleConcern: updatedGroups.length <= 1,
    cohesionScore: updatedGroups.length > 1 ? Number((1 / updatedGroups.length).toFixed(2)) : 1.0,
  };

  validateCommitPlanInvariants(updatedPlan, allStagedFiles);
  return updatedPlan;
}

/**
 * Reorders groups in the plan.
 */
export function reorderGroups(plan: CommitPlan, groupIds: string[]): CommitPlan {
  if (groupIds.length !== plan.groups.length) {
    throw new Error("Reorder group count does not match existing groups count.");
  }

  const groupMap = new Map(plan.groups.map((g) => [g.id, g]));
  const reordered: CommitGroup[] = [];

  for (const id of groupIds) {
    const g = groupMap.get(id);
    if (!g) {
      throw new Error(`Group '${id}' not found in plan.`);
    }
    reordered.push(g);
  }

  return {
    ...plan,
    groups: reordered,
  };
}
