import path from "node:path";
import fs from "node:fs/promises";
import { loadConfig } from "@gitwhisper/config";
import {
  buildChangeContext,
  buildCommitPlan,
  buildHunkCommitPlan,
  buildPatchSelection,
  buildRemainingPatch,
  formatCommitSubject,
  type CommitPlan,
  type HunkCommitPlan,
} from "@gitwhisper/core";
import {
  captureStateSnapshot,
  executeHunkGroupCommit,
  executeIsolatedGroupCommit,
  findRepository,
  getIndexFingerprint,
  getStagedIndexEntries,
  hasStagedChanges,
  syncPrimaryIndex,
  updatePrimaryIndexWithRemainingHunks,
  verifyWorkingTreeUnchanged,
} from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface SplitCommandOptions {
  plan?: CommitPlan;
  hunkPlan?: HunkCommitPlan;
  dryRun?: boolean;
}

export async function runSplit(options: SplitCommandOptions = {}): Promise<void> {
  const repoRoot = await findRepository();
  if (!repoRoot) {
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    process.exit(1);
  }

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    printHeader();
    console.log(" No staged changes found.\n Stage files first: git add <files>\n");
    process.exit(1);
  }

  const config = await loadConfig();

  // If a hunkPlan is provided or if we can run hunk planning
  let hunkPlan = options.hunkPlan;
  let filePlan = options.plan;

  if (!hunkPlan && !filePlan) {
    const context = await buildChangeContext(repoRoot);
    if (config.planning.allowHunkLevelSplitting) {
      hunkPlan = await buildHunkCommitPlan(repoRoot, context, config.planning);
    } else {
      filePlan = await buildCommitPlan(repoRoot, context, config.planning);
    }
  }

  // --- Hunk-Level Split Execution ---
  if (hunkPlan) {
    const currentFingerprint = await getIndexFingerprint(repoRoot);
    if (currentFingerprint !== hunkPlan.indexFingerprint) {
      console.error(
        `\n ${colors.red}Error: Staged changes have changed since the commit plan was created.${colors.reset}`,
      );
      console.error(
        ` Expected fingerprint: ${hunkPlan.indexFingerprint.slice(0, 10)}..., but index has: ${currentFingerprint.slice(0, 10)}...`,
      );
      console.error(" Please review the updated plan with `gitwhisper plan`.\n");
      process.exit(1);
    }

    if (hunkPlan.groups.length <= 1) {
      console.log(
        `\n ${colors.yellow}Notice: Staged changes represent a single concern.${colors.reset}`,
      );
      console.log(" Use `gitwhisper` to create a standard single commit for these changes.\n");
      return;
    }

    console.log(
      `\n ${colors.bold}Executing Hunk-Level Commit Splitting (${hunkPlan.groups.length} commits)${colors.reset}\n`,
    );

    const filesToTrack = hunkPlan.patch.files.map((f) => f.newPath || f.oldPath || "");
    const stateSnapshot = await captureStateSnapshot(repoRoot, filesToTrack);

    const createdCommits: Array<{
      id: string;
      hash: string;
      subject: string;
      hunkIds: string[];
    }> = [];

    const committedHunkIds: string[] = [];
    const tempIndexFile = path.join(
      repoRoot,
      ".git",
      `whisper-hunk-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    for (let i = 0; i < hunkPlan.groups.length; i++) {
      const group = hunkPlan.groups[i];
      let subject = group.name;
      let body: string | undefined;

      if ((group as any).proposal) {
        subject = formatCommitSubject((group as any).proposal);
        body = (group as any).proposal.body;
      }

      const groupPatch = buildPatchSelection(hunkPlan.patch, group.hunkIds);

      if (options.dryRun) {
        console.log(
          ` ${colors.yellow}[Dry Run]${colors.reset} Would commit group ${colors.bold}${group.id}${colors.reset} (${group.hunkIds.length} hunks):`,
        );
        console.log(`   ${colors.green}${subject}${colors.reset}`);
        for (const fc of group.fileChanges) {
          console.log(`   ${colors.dim}• ${fc.file} [${fc.hunkIds.join(", ")}]${colors.reset}`);
        }
        console.log("");
        continue;
      }

      process.stdout.write(
        ` [${i + 1}/${hunkPlan.groups.length}] Committing group ${group.id}: ${subject}... `,
      );

      try {
        const result = await executeHunkGroupCommit(repoRoot, {
          patchContent: groupPatch,
          subject,
          body,
          tempIndexFile,
        });

        console.log(`${colors.green}✓ ${result.commitHash.slice(0, 7)}${colors.reset}`);
        createdCommits.push({
          id: group.id,
          hash: result.commitHash,
          subject,
          hunkIds: group.hunkIds,
        });
        committedHunkIds.push(...group.hunkIds);

        // Verify working tree files remain untouched
        const workingTreeIntact = await verifyWorkingTreeUnchanged(repoRoot, stateSnapshot);
        if (!workingTreeIntact) {
          throw new Error(
            "Working tree integrity invariant failed: unstaged disk modifications were altered!",
          );
        }
      } catch (err: any) {
        console.log(`${colors.red}FAILED${colors.reset}`);
        console.error(
          `\n ${colors.red}Commit halted at group ${group.id}:${colors.reset} ${err.message}`,
        );

        // Recover primary index with uncommitted hunks
        const remainingPatch = buildRemainingPatch(hunkPlan.patch, committedHunkIds);
        try {
          await updatePrimaryIndexWithRemainingHunks(repoRoot, remainingPatch, tempIndexFile);
        } catch {
          // ignore
        }
        try {
          await fs.unlink(tempIndexFile);
        } catch {
          // ignore
        }

        console.log(`\n ${colors.bold}Split Execution Status:${colors.reset}`);
        if (createdCommits.length > 0) {
          console.log(
            ` ${colors.green}Successfully committed (${createdCommits.length}):${colors.reset}`,
          );
          for (const c of createdCommits) {
            console.log(`   ${colors.bold}${c.hash.slice(0, 7)}${colors.reset} ${c.subject}`);
          }
        }

        const remaining = hunkPlan.groups.slice(i);
        console.log(
          `\n ${colors.yellow}Remaining uncommitted groups (${remaining.length}):${colors.reset}`,
        );
        for (const rem of remaining) {
          console.log(`   • ${rem.id}: ${rem.name} (${rem.hunkIds.length} hunks)`);
        }

        console.log(
          "\n Remaining changes remain staged in Git. Resolve the hook/issue and run `gitwhisper plan` again.\n",
        );
        process.exit(1);
      }
    }

    if (options.dryRun) {
      console.log(` ${colors.yellow}[Dry run] No commits were created.${colors.reset}\n`);
      return;
    }

    // Update primary index with any remaining hunks (or clean index if all were committed)
    const finalRemainingPatch = buildRemainingPatch(hunkPlan.patch, committedHunkIds);
    await updatePrimaryIndexWithRemainingHunks(repoRoot, finalRemainingPatch, tempIndexFile);
    try {
      await fs.unlink(tempIndexFile);
    } catch {
      // ignore
    }

    console.log(`\n ${colors.green}✓ Split completed successfully!${colors.reset}`);
    console.log(
      ` ${colors.dim}Created ${createdCommits.length} commits. Staged index synchronized. Working tree untouched.${colors.reset}\n`,
    );
    return;
  }

  // --- Fallback File-Level Split Execution ---
  if (!filePlan) {
    const context = await buildChangeContext(repoRoot);
    filePlan = await buildCommitPlan(repoRoot, context, config.planning);
  }

  const currentFingerprint = await getIndexFingerprint(repoRoot);
  if (currentFingerprint !== filePlan.indexFingerprint) {
    console.error(
      `\n ${colors.red}Error: Staged changes have changed since the commit plan was created.${colors.reset}`,
    );
    process.exit(1);
  }

  if (filePlan.groups.length <= 1) {
    console.log(
      `\n ${colors.yellow}Notice: Staged changes represent a single concern.${colors.reset}\n`,
    );
    return;
  }

  console.log(
    `\n ${colors.bold}Executing File-Level Commit Splitting (${filePlan.groups.length} commits)${colors.reset}\n`,
  );

  const createdCommits: Array<{ id: string; hash: string; subject: string }> = [];
  const stagedEntries = await getStagedIndexEntries(repoRoot);
  const tempIndexFile = path.join(
    repoRoot,
    ".git",
    `whisper-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  for (let i = 0; i < filePlan.groups.length; i++) {
    const group = filePlan.groups[i];
    let subject = group.name;
    let body: string | undefined;

    if (group.proposal) {
      subject = formatCommitSubject(group.proposal);
      body = group.proposal.body;
    }

    if (options.dryRun) {
      console.log(` ${colors.yellow}[Dry Run] Would commit group ${group.id}: ${subject}`);
      continue;
    }

    try {
      const result = await executeIsolatedGroupCommit(repoRoot, {
        files: group.files,
        stagedEntries,
        subject,
        body,
        tempIndexFile,
      });
      createdCommits.push({ id: group.id, hash: result.commitHash, subject });
    } catch (err: any) {
      console.error(`\n ${colors.red}Halted at group ${group.id}:${colors.reset} ${err.message}`);
      process.exit(1);
    }
  }

  if (!options.dryRun) {
    await syncPrimaryIndex(repoRoot, tempIndexFile);
    try {
      await fs.unlink(tempIndexFile);
    } catch {
      // ignore
    }
    console.log(
      `\n ${colors.green}✓ Split completed successfully (${createdCommits.length} commits)!${colors.reset}\n`,
    );
  }
}
