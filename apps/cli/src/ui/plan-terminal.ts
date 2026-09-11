import readline from "node:readline";
import type { CommitPlan } from "@gitwhisper/core";
import { colors } from "./terminal.js";

/**
 * Renders the commit plan in a clear terminal dashboard.
 */
export function renderCommitPlan(plan: CommitPlan, options: { details?: boolean } = {}): void {
  console.log(`\n ${colors.bold}${colors.cyan}Commit Plan${colors.reset}`);
  console.log(
    ` ${colors.dim}Index Fingerprint:${colors.reset} ${plan.indexFingerprint.slice(0, 12)}...`,
  );
  console.log(` ${colors.dim}Total Files:      ${colors.reset} ${plan.totalFiles}`);
  console.log(
    ` ${colors.dim}Cohesion Score:   ${colors.reset} ${(plan.cohesionScore * 100).toFixed(0)}% ${
      plan.isSingleConcern
        ? `${colors.green}(Single concern)${colors.reset}`
        : `${colors.yellow}(Multi-concern detected)${colors.reset}`
    }`,
  );
  console.log(` ${colors.dim}Proposed Commits: ${colors.reset} ${plan.groups.length}\n`);

  if (plan.warnings.length > 0) {
    for (const warn of plan.warnings) {
      console.log(` ${colors.yellow}💡 ${warn}${colors.reset}`);
    }
    console.log("");
  }

  plan.groups.forEach((group, index) => {
    const header = ` Group ${index + 1}: ${group.name} (${group.id}) `;
    console.log(` ${colors.bold}${colors.blue}┌${"─".repeat(header.length + 2)}┐${colors.reset}`);
    console.log(
      ` ${colors.bold}${colors.blue}│${colors.reset} ${colors.bold}${header}${colors.reset} ${colors.blue}│${colors.reset}`,
    );
    console.log(` ${colors.bold}${colors.blue}└${"─".repeat(header.length + 2)}┘${colors.reset}`);

    console.log(`   ${colors.dim}Concern:${colors.reset} ${group.concern}`);
    console.log(`   ${colors.dim}Files (${group.files.length}):${colors.reset}`);
    for (const f of group.files) {
      console.log(`     ${colors.cyan}•${colors.reset} ${f}`);
    }

    if (group.proposal) {
      const scopePart = group.proposal.scope ? `(${group.proposal.scope})` : "";
      const msg = `${group.proposal.type}${scopePart}: ${group.proposal.description}`;
      console.log(
        `   ${colors.dim}Proposed commit:${colors.reset} ${colors.green}${msg}${colors.reset}`,
      );
    }

    if (options.details && group.relationships.length > 0) {
      console.log(`   ${colors.dim}Relationships:${colors.reset}`);
      for (const r of group.relationships) {
        console.log(
          `     ${colors.dim}↳ ${r.type}: ${r.source} ↔ ${r.target} (${(r.confidence * 100).toFixed(0)}%)${colors.reset}`,
        );
      }
    }

    console.log("");
  });

  if (options.details && plan.relationships.length > 0) {
    console.log(` ${colors.bold}All Detected Relationships:${colors.reset}`);
    for (const r of plan.relationships) {
      console.log(
        `   ${colors.dim}[${r.type}]${colors.reset} ${r.source} ↔ ${r.target} ${colors.dim}(${(r.confidence * 100).toFixed(0)}% - ${r.reason})${colors.reset}`,
      );
    }
    console.log("");
  }
}

export type PlanAction = "split" | "keep" | "edit" | "merge" | "details" | "cancel";

/**
 * Prompts user for action on a commit plan.
 */
export async function promptPlanAction(detailsShown: boolean): Promise<PlanAction> {
  console.log(` ${colors.bold}[s]${colors.reset} Split into separate commits`);
  console.log(` ${colors.bold}[k]${colors.reset} Keep as single commit`);
  console.log(` ${colors.bold}[e]${colors.reset} Edit groups (move a file)`);
  console.log(` ${colors.bold}[m]${colors.reset} Merge groups`);
  console.log(` ${colors.bold}[d]${colors.reset} ${detailsShown ? "Hide" : "Show"} graph details`);
  console.log(` ${colors.bold}[q]${colors.reset} Cancel\n`);

  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question("> ", (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        if (a === "s") return resolve("split");
        if (a === "e") return resolve("edit");
        if (a === "m") return resolve("merge");
        if (a === "d") return resolve("details");
        if (a === "q") return resolve("cancel");
        return resolve("keep");
      });
    });
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      const name = (key.name || "").toLowerCase();
      if (name === "s") {
        cleanup();
        resolve("split");
      } else if (name === "k" || name === "return" || name === "enter") {
        cleanup();
        resolve("keep");
      } else if (name === "e") {
        cleanup();
        resolve("edit");
      } else if (name === "m") {
        cleanup();
        resolve("merge");
      } else if (name === "d") {
        cleanup();
        resolve("details");
      } else if (name === "q") {
        cleanup();
        resolve("cancel");
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw);
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * Prompts user to move a file from one group to another.
 */
export async function promptMoveFile(
  plan: CommitPlan,
): Promise<{ filePath: string; targetGroupId: string } | null> {
  const allFiles = plan.groups.flatMap((g) => g.files);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string) => new Promise<string>((res) => rl.question(query, res));

  console.log(`\n ${colors.bold}Move File Between Groups${colors.reset}`);
  allFiles.forEach((file, idx) => {
    const currentGroup = plan.groups.find((g) => g.files.includes(file));
    console.log(`  [${idx + 1}] ${file} (in ${currentGroup?.id})`);
  });

  const fileIdxStr = await question("\n Enter file number to move (or Enter to cancel): ");
  const fileIdx = Number.parseInt(fileIdxStr.trim(), 10);
  if (Number.isNaN(fileIdx) || fileIdx < 1 || fileIdx > allFiles.length) {
    rl.close();
    return null;
  }

  const selectedFile = allFiles[fileIdx - 1];

  console.log("\n Target Groups:");
  plan.groups.forEach((g, idx) => {
    console.log(`  [${idx + 1}] ${g.id}: ${g.name}`);
  });

  const groupIdxStr = await question("\n Enter target group number: ");
  rl.close();
  const groupIdx = Number.parseInt(groupIdxStr.trim(), 10);
  if (Number.isNaN(groupIdx) || groupIdx < 1 || groupIdx > plan.groups.length) {
    return null;
  }

  return {
    filePath: selectedFile,
    targetGroupId: plan.groups[groupIdx - 1].id,
  };
}

/**
 * Prompts user to merge two groups.
 */
export async function promptMergeGroups(
  plan: CommitPlan,
): Promise<{ sourceGroupId: string; targetGroupId: string } | null> {
  if (plan.groups.length < 2) {
    console.log(" Need at least 2 groups to merge.");
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (query: string) => new Promise<string>((res) => rl.question(query, res));

  console.log(`\n ${colors.bold}Merge Groups${colors.reset}`);
  plan.groups.forEach((g, idx) => {
    console.log(`  [${idx + 1}] ${g.id}: ${g.name} (${g.files.length} files)`);
  });

  const srcStr = await question("\n Enter group number to merge FROM: ");
  const srcIdx = Number.parseInt(srcStr.trim(), 10);
  if (Number.isNaN(srcIdx) || srcIdx < 1 || srcIdx > plan.groups.length) {
    rl.close();
    return null;
  }

  const targetStr = await question(" Enter group number to merge INTO: ");
  rl.close();
  const targetIdx = Number.parseInt(targetStr.trim(), 10);
  if (
    Number.isNaN(targetIdx) ||
    targetIdx < 1 ||
    targetIdx > plan.groups.length ||
    targetIdx === srcIdx
  ) {
    return null;
  }

  return {
    sourceGroupId: plan.groups[srcIdx - 1].id,
    targetGroupId: plan.groups[targetIdx - 1].id,
  };
}
