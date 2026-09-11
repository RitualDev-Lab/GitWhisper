import readline from "node:readline";
import { loadConfig } from "@gitwhisper/config";
import {
  buildChangeContext,
  buildCommitPlan,
  buildHunkCommitPlan,
  buildPatchSelection,
  moveHunkBetweenGroups,
  mergeHunkGroups,
  type CommitPlan,
  type HunkCommitPlan,
} from "@gitwhisper/core";
import { findRepository, hasStagedChanges } from "@gitwhisper/git";
import {
  promptHunkPlanAction,
  promptMoveHunk,
  renderHunkCommitPlan,
  renderPatchPreview,
} from "../ui/hunk-terminal.js";
import { colors, printHeader } from "../ui/terminal.js";
import { runSplit } from "./split.js";

export interface PlanCommandOptions {
  json?: boolean;
  details?: boolean;
  interactive?: boolean;
  level?: "file" | "hunk" | "auto";
}

export async function runPlan(
  options: PlanCommandOptions = {},
): Promise<CommitPlan | HunkCommitPlan | undefined> {
  const repoRoot = await findRepository();
  if (!repoRoot) {
    if (!options.json) {
      printHeader();
      console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    } else {
      console.error(JSON.stringify({ error: "Not inside a Git repository" }));
    }
    process.exit(1);
  }

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    if (!options.json) {
      printHeader();
      console.log(" No staged changes found.\n Stage files first: git add <files>\n");
    } else {
      console.error(JSON.stringify({ error: "No staged changes found" }));
    }
    process.exit(1);
  }

  const config = await loadConfig();
  const context = await buildChangeContext(repoRoot);

  if (options.level === "file") {
    const filePlan = await buildCommitPlan(repoRoot, context, config.planning);
    if (options.json) {
      console.log(JSON.stringify(filePlan, null, 2));
      return filePlan;
    }
  }

  let hunkPlan = await buildHunkCommitPlan(repoRoot, context, config.planning);

  if (options.json) {
    console.log(JSON.stringify(hunkPlan, null, 2));
    return hunkPlan;
  }

  printHeader();

  let details = Boolean(options.details);

  if (!options.interactive && !process.stdin.isTTY) {
    renderHunkCommitPlan(hunkPlan, { details });
    return hunkPlan;
  }

  while (true) {
    renderHunkCommitPlan(hunkPlan, { details });
    const action = await promptHunkPlanAction(details);

    if (action === "split") {
      await runSplit({ hunkPlan });
      return hunkPlan;
    }

    if (action === "details") {
      details = !details;
      continue;
    }

    if (action === "preview") {
      if (hunkPlan.groups.length === 1) {
        const patchStr = buildPatchSelection(hunkPlan.patch, hunkPlan.groups[0].hunkIds);
        renderPatchPreview(patchStr, hunkPlan.groups[0].name);
      } else {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const question = (q: string) => new Promise<string>((res) => rl.question(q, res));

        console.log("\n Select group to preview:");
        hunkPlan.groups.forEach((g, idx) => {
          console.log(`  [${idx + 1}] ${g.id}: ${g.name} (${g.hunkIds.length} hunks)`);
        });

        const ans = await question("\n Enter group number: ");
        rl.close();
        const gIdx = Number.parseInt(ans.trim(), 10);
        if (!Number.isNaN(gIdx) && gIdx >= 1 && gIdx <= hunkPlan.groups.length) {
          const g = hunkPlan.groups[gIdx - 1];
          const patchStr = buildPatchSelection(hunkPlan.patch, g.hunkIds);
          renderPatchPreview(patchStr, g.name);
        }
      }
      continue;
    }

    if (action === "move") {
      const move = await promptMoveHunk(hunkPlan);
      if (move) {
        try {
          hunkPlan = moveHunkBetweenGroups(hunkPlan, move.hunkId, move.targetGroupId);
          console.log(
            `\n ${colors.green}✓ Moved ${move.hunkId} to ${move.targetGroupId}${colors.reset}\n`,
          );
        } catch (err: any) {
          console.error(`\n ${colors.red}Error:${colors.reset} ${err.message}\n`);
        }
      }
      continue;
    }

    if (action === "merge") {
      if (hunkPlan.groups.length < 2) {
        console.log(" Need at least 2 groups to merge.");
        continue;
      }
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const question = (q: string) => new Promise<string>((res) => rl.question(q, res));

      console.log("\n Merge Hunk Groups:");
      hunkPlan.groups.forEach((g, idx) => {
        console.log(`  [${idx + 1}] ${g.id}: ${g.name}`);
      });

      const srcAns = await question("\n Merge FROM group number: ");
      const srcIdx = Number.parseInt(srcAns.trim(), 10);
      const targetAns = await question(" Merge INTO group number: ");
      rl.close();
      const targetIdx = Number.parseInt(targetAns.trim(), 10);

      if (
        !Number.isNaN(srcIdx) &&
        !Number.isNaN(targetIdx) &&
        srcIdx !== targetIdx &&
        srcIdx >= 1 &&
        srcIdx <= hunkPlan.groups.length &&
        targetIdx >= 1 &&
        targetIdx <= hunkPlan.groups.length
      ) {
        try {
          hunkPlan = mergeHunkGroups(
            hunkPlan,
            hunkPlan.groups[srcIdx - 1].id,
            hunkPlan.groups[targetIdx - 1].id,
          );
          console.log(`\n ${colors.green}✓ Groups merged successfully${colors.reset}\n`);
        } catch (err: any) {
          console.error(`\n ${colors.red}Error:${colors.reset} ${err.message}\n`);
        }
      }
      continue;
    }

    if (action === "keep" || action === "cancel") {
      return hunkPlan;
    }
  }
}
