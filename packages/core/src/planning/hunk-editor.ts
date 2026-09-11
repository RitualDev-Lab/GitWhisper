import type { ChangeContext } from "../types.js";
import { validateHunkPlanInvariants, type HunkCommitPlan } from "./hunk-planner.js";
import type { HunkFileChange } from "./hunk-clustering.js";

/**
 * Rebuilds fileChanges mapping for a set of hunk IDs.
 */
function rebuildFileChanges(hunkIds: string[], plan: HunkCommitPlan): HunkFileChange[] {
  const fileToHunks = new Map<string, string[]>();

  for (const file of plan.patch.files) {
    const filePath = file.newPath || file.oldPath || "unknown";
    for (const h of file.hunks) {
      if (hunkIds.includes(h.id)) {
        if (!fileToHunks.has(filePath)) {
          fileToHunks.set(filePath, []);
        }
        fileToHunks.get(filePath)?.push(h.id);
      }
    }
  }

  const changes: HunkFileChange[] = [];
  for (const [filePath, fHunks] of fileToHunks.entries()) {
    const file = plan.patch.files.find((f) => (f.newPath || f.oldPath) === filePath);
    const wholeFile = Boolean(file && fHunks.length === file.hunks.length);
    changes.push({
      file: filePath,
      hunkIds: fHunks,
      wholeFile,
    });
  }

  return changes;
}

/**
 * Moves a hunk from its current group to a target group.
 */
export function moveHunkBetweenGroups(
  plan: HunkCommitPlan,
  hunkId: string,
  targetGroupId: string,
): HunkCommitPlan {
  const targetGroup = plan.groups.find((g) => g.id === targetGroupId);
  if (!targetGroup) {
    throw new Error(`Target group '${targetGroupId}' not found in plan.`);
  }

  const sourceGroup = plan.groups.find((g) => g.hunkIds.includes(hunkId));
  if (!sourceGroup) {
    throw new Error(`Hunk '${hunkId}' not found in any group.`);
  }

  if (sourceGroup.id === targetGroupId) {
    return plan;
  }

  const newSourceHunks = sourceGroup.hunkIds.filter((id) => id !== hunkId);
  const newTargetHunks = [...targetGroup.hunkIds, hunkId];

  const updatedGroups = [];
  for (const group of plan.groups) {
    if (group.id === sourceGroup.id) {
      if (newSourceHunks.length > 0) {
        updatedGroups.push({
          ...group,
          hunkIds: newSourceHunks,
          fileChanges: rebuildFileChanges(newSourceHunks, plan),
        });
      }
    } else if (group.id === targetGroup.id) {
      updatedGroups.push({
        ...group,
        hunkIds: newTargetHunks,
        fileChanges: rebuildFileChanges(newTargetHunks, plan),
      });
    } else {
      updatedGroups.push(group);
    }
  }

  const allStagedHunkIds = plan.groups.flatMap((g) => g.hunkIds);
  const updatedPlan: HunkCommitPlan = {
    ...plan,
    groups: updatedGroups,
    isSingleConcern: updatedGroups.length <= 1,
    cohesionScore: updatedGroups.length > 1 ? Number((1 / updatedGroups.length).toFixed(2)) : 1.0,
  };

  validateHunkPlanInvariants(updatedPlan, allStagedHunkIds);
  return updatedPlan;
}

/**
 * Merges two hunk groups together into one.
 */
export function mergeHunkGroups(
  plan: HunkCommitPlan,
  sourceGroupId: string,
  targetGroupId: string,
): HunkCommitPlan {
  if (sourceGroupId === targetGroupId) return plan;

  const sourceGroup = plan.groups.find((g) => g.id === sourceGroupId);
  const targetGroup = plan.groups.find((g) => g.id === targetGroupId);

  if (!sourceGroup || !targetGroup) {
    throw new Error("One or both groups not found in plan.");
  }

  const combinedHunks = [...targetGroup.hunkIds, ...sourceGroup.hunkIds];
  const mergedTarget = {
    ...targetGroup,
    name: `${targetGroup.name} & ${sourceGroup.name}`,
    concern: `${targetGroup.concern}; ${sourceGroup.concern}`,
    hunkIds: combinedHunks,
    fileChanges: rebuildFileChanges(combinedHunks, plan),
  };

  const updatedGroups = plan.groups
    .filter((g) => g.id !== sourceGroupId)
    .map((g) => (g.id === targetGroupId ? mergedTarget : g));

  const allStagedHunkIds = plan.groups.flatMap((g) => g.hunkIds);
  const updatedPlan: HunkCommitPlan = {
    ...plan,
    groups: updatedGroups,
    isSingleConcern: updatedGroups.length <= 1,
    cohesionScore: updatedGroups.length > 1 ? Number((1 / updatedGroups.length).toFixed(2)) : 1.0,
  };

  validateHunkPlanInvariants(updatedPlan, allStagedHunkIds);
  return updatedPlan;
}
