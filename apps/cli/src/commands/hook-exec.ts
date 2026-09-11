import fs from "node:fs/promises";
import { loadConfig, resolveCommitPolicy } from "@gitwhisper/config";
import {
  analyzeRepositoryHistory,
  buildChangeContext,
  checkCommitQuality,
  parseBranchContext,
} from "@gitwhisper/core";
import {
  findRepository,
  getCommitHistory,
  getRepositoryInfo,
  hasStagedChanges,
} from "@gitwhisper/git";
import { colors } from "../ui/terminal.js";

/**
 * Executes a Git hook (commit-msg).
 * Offline, fast (<50ms), zero AI, zero network calls.
 */
export async function runHookExec(hookType: string, filePath?: string): Promise<void> {
  if (hookType !== "commit-msg" || !filePath) {
    process.exit(0);
  }

  let mode: "off" | "warn" | "strict" = "warn";

  try {
    const repoRoot = await findRepository();
    if (!repoRoot) {
      process.exit(0);
    }

    const config = await loadConfig({}, repoRoot);
    mode = config.hooks.commitMsg;

    if (mode === "off") {
      process.exit(0);
    }

    let message: string;
    try {
      message = await fs.readFile(filePath, "utf8");
    } catch {
      process.exit(0);
    }

    // Strip comments
    const nonComment = message
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n")
      .trim();

    if (!nonComment) {
      process.exit(0);
    }

    const repo = await getRepositoryInfo(repoRoot);
    const branchContext = parseBranchContext(repo.branch, config.workItems.patterns);

    let changeContext: any;
    if (await hasStagedChanges(repoRoot)) {
      changeContext = await buildChangeContext(repoRoot, {
        configuredScopes: config.commit.scopes,
        strictScopes: config.commit.strictScopes,
      });
    }

    let repoStyle: any;
    try {
      const commits = await getCommitHistory(repoRoot, { limit: config.history.limit });
      if (commits.length > 0) {
        repoStyle = analyzeRepositoryHistory(commits, {
          minimumSampleSize: 5,
          includeMergeCommits: config.history.includeMergeCommits,
        });
      }
    } catch {
      // ignore
    }

    const policy = resolveCommitPolicy(config, repoStyle);

    const result = await checkCommitQuality({
      message,
      policy,
      changeContext,
      branchContext,
      strict: mode === "strict",
    });

    // Check for secret leakage (always strictly protected)
    const secretIssue = result.issues.find((i) => i.code === "SECRET_IN_COMMIT_MESSAGE");
    if (secretIssue) {
      console.error(`\n ${colors.red}GitWhisper Security Alert (BLOCKED):${colors.reset}`);
      console.error(` ${colors.red}Possible credential detected in commit message!${colors.reset}`);
      console.error(` ${colors.dim}Issue: SECRET_IN_COMMIT_MESSAGE${colors.reset}`);
      console.error(
        ` ${colors.dim}Commit messages are permanently stored in Git history.${colors.reset}\n`,
      );
      process.exit(1);
    }

    if (result.issues.length === 0) {
      process.exit(0);
    }

    // Format output
    if (mode === "warn") {
      console.error(`\n ${colors.cyan}GitWhisper Quality Warning:${colors.reset}`);
      for (const issue of result.issues) {
        console.error(`   • ${issue.message}`);
      }
      if (result.suggested) {
        console.error(
          `\n ${colors.dim}Suggested:${colors.reset} ${colors.green}${result.suggested.subject}${colors.reset}`,
        );
      }
      console.error(`\n ${colors.dim}Commit allowed because hook mode is WARN.${colors.reset}\n`);
      process.exit(0);
    }

    if (mode === "strict") {
      console.error(`\n ${colors.red}GitWhisper Quality Rejected:${colors.reset}`);
      for (const issue of result.issues) {
        console.error(`   • ${issue.message}`);
      }
      if (result.suggested) {
        console.error(
          `\n ${colors.dim}Suggested:${colors.reset} ${colors.green}${result.suggested.subject}${colors.reset}`,
        );
      }
      console.error(
        `\n ${colors.red}Commit rejected because hook mode is STRICT.${colors.reset}\n`,
      );
      process.exit(1);
    }

    process.exit(0);
  } catch (err: any) {
    if (mode === "strict") {
      console.error(`\n ${colors.red}GitWhisper Hook Error:${colors.reset} ${err.message}\n`);
      process.exit(1);
    } else {
      // In warn mode: do not block commit on unexpected validator crash
      console.error(`\n ${colors.yellow}GitWhisper Hook Warning:${colors.reset} ${err.message}\n`);
      process.exit(0);
    }
  }
}
