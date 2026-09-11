import readline from "node:readline";
import type { HunkCommitPlan } from "@gitwhisper/core";
import { colors } from "./terminal.js";

/**
 * Renders the hunk-level commit plan.
 */
export function renderHunkCommitPlan(
  plan: HunkCommitPlan,
  options: { details?: boolean } = {},
): void {
  console.log(
    `\n ${colors.bold}${colors.cyan}Commit Plan (Hunk-Level Intelligence)${colors.reset}`,
  );
  console.log(
    ` ${colors.dim}Index Fingerprint:${colors.reset} ${plan.indexFingerprint.slice(0, 12)}...`,
  );
  console.log(
    ` ${colors.dim}Granularity:      ${colors.reset} ${colors.magenta}${plan.granularity}${colors.reset}`,
  );
  console.log(
    ` ${colors.dim}Total Files/Hunks:${colors.reset} ${plan.totalFiles} files / ${plan.totalHunks} hunks`,
  );
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
    console.log(`   ${colors.dim}Changes:${colors.reset}`);
    for (const f of group.fileChanges) {
      const wholeLabel = f.wholeFile ? ` ${colors.dim}(whole file)${colors.reset}` : "";
      console.log(
        `     ${colors.cyan}•${colors.reset} ${f.file} [${f.hunkIds.join(", ")}]${wholeLabel}`,
      );
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
          `     ${colors.dim}↳ [${r.type}] ${r.sourceHunkId} ↔ ${r.targetHunkId} (${(r.confidence * 100).toFixed(0)}% - ${r.reason})${colors.reset}`,
        );
      }
    }

    console.log("");
  });
}

/**
 * Renders colorized patch preview.
 */
export function renderPatchPreview(patchContent: string, title?: string): void {
  console.log(
    `\n ${colors.bold}--- Patch Preview: ${title || "Selected Commits"} ---${colors.reset}\n`,
  );
  const lines = patchContent.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ")) {
      console.log(` ${colors.bold}${line}${colors.reset}`);
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      console.log(` ${colors.bold}${line}${colors.reset}`);
    } else if (line.startsWith("@@")) {
      console.log(` ${colors.cyan}${line}${colors.reset}`);
    } else if (line.startsWith("+")) {
      console.log(` ${colors.green}${line}${colors.reset}`);
    } else if (line.startsWith("-")) {
      console.log(` ${colors.red}${line}${colors.reset}`);
    } else {
      console.log(` ${colors.dim}${line}${colors.reset}`);
    }
  }
  console.log(`\n ${colors.bold}--- End of Patch ---${colors.reset}\n`);
}

export type HunkPlanAction = "split" | "keep" | "preview" | "move" | "merge" | "details" | "cancel";

/**
 * Prompts user for interactive hunk plan actions.
 */
export async function promptHunkPlanAction(detailsShown: boolean): Promise<HunkPlanAction> {
  console.log(` ${colors.bold}[s]${colors.reset} Split into separate commits`);
  console.log(` ${colors.bold}[k]${colors.reset} Keep as single commit`);
  console.log(` ${colors.bold}[p]${colors.reset} Preview selected patch`);
  console.log(` ${colors.bold}[m]${colors.reset} Move hunk between groups`);
  console.log(` ${colors.bold}[g]${colors.reset} Merge groups`);
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
        if (a === "p") return resolve("preview");
        if (a === "m") return resolve("move");
        if (a === "g") return resolve("merge");
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
      } else if (name === "p") {
        cleanup();
        resolve("preview");
      } else if (name === "m") {
        cleanup();
        resolve("move");
      } else if (name === "g") {
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
 * Prompts user to select a hunk to move to another group.
 */
export async function promptMoveHunk(
  plan: HunkCommitPlan,
): Promise<{ hunkId: string; targetGroupId: string } | null> {
  const allHunks: Array<{ hunkId: string; file: string; groupId: string }> = [];

  for (const group of plan.groups) {
    for (const fc of group.fileChanges) {
      for (const hId of fc.hunkIds) {
        allHunks.push({
          hunkId: hId,
          file: fc.file,
          groupId: group.id,
        });
      }
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q: string) => new Promise<string>((res) => rl.question(q, res));

  console.log(`\n ${colors.bold}Move Hunk Between Groups${colors.reset}`);
  allHunks.forEach((item, idx) => {
    console.log(`  [${idx + 1}] ${item.hunkId} in ${item.file} (currently in ${item.groupId})`);
  });

  const hunkIdxStr = await question("\n Enter hunk number to move (or Enter to cancel): ");
  const hunkIdx = Number.parseInt(hunkIdxStr.trim(), 10);
  if (Number.isNaN(hunkIdx) || hunkIdx < 1 || hunkIdx > allHunks.length) {
    rl.close();
    return null;
  }

  const selected = allHunks[hunkIdx - 1];

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
    hunkId: selected.hunkId,
    targetGroupId: plan.groups[groupIdx - 1].id,
  };
}
