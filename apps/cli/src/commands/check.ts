import fs from "node:fs/promises";
import path from "node:path";
import { InvalidConfigError, loadConfig, resolveCommitPolicy } from "@gitwhisper/config";
import {
  analyzeRepositoryHistory,
  buildChangeContext,
  checkCommitQuality,
  parseBranchContext,
  reviewQualityWithAI,
} from "@gitwhisper/core";
import {
  findRepository,
  getCommitDetails,
  getCommitHistory,
  getRepositoryInfo,
  hasStagedChanges,
} from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface CheckOptions {
  message?: string;
  strict?: boolean;
  json?: boolean;
  ai?: boolean;
  style?: "auto" | "conventional" | "simple";
}

export async function runCheck(target?: string, options: CheckOptions = {}): Promise<void> {
  const repoRoot = await findRepository();
  if (!repoRoot) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "NOT_A_GIT_REPOSITORY",
              message: "Not inside a Git repository.",
            },
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    process.exit(2);
  }

  let config: any;
  try {
    config = await loadConfig({}, repoRoot);
  } catch (err: any) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "INVALID_CONFIG",
              message: err.message,
              details: err instanceof InvalidConfigError ? err.errors : [],
            },
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
    printHeader();
    console.error(` ${colors.red}Configuration Error:${colors.reset}\n${err.message}\n`);
    process.exit(2);
  }

  const repo = await getRepositoryInfo(repoRoot);
  const branchContext = parseBranchContext(repo.branch, config.workItems.patterns);

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
    // Graceful fallback if no history
  }

  const policy = resolveCommitPolicy(config, repoStyle, {
    style: options.style,
  });

  // Determine message to check and changeContext
  let messageToCheck = options.message;
  let changeContext: any;
  let isReviewingExistingCommit = false;
  const commitIsh = target;

  if (target) {
    // Check if target is a commit-ish
    const commitDetails = await getCommitDetails(repoRoot, target);
    if (commitDetails) {
      isReviewingExistingCommit = true;
      messageToCheck = commitDetails.message;
      changeContext = {
        repository: {
          root: repoRoot,
          name: repo.name,
          branch: repo.branch,
          head: repo.head,
          isInitial: repo.isInitial,
        },
        files: commitDetails.changedFiles.map((f) => ({
          ...f,
          category: f.path.includes("test")
            ? "test"
            : f.path.endsWith(".md")
              ? "documentation"
              : "source",
        })),
        stats: {
          filesChanged: commitDetails.changedFiles.length,
          additions: 0,
          deletions: 0,
        },
        patch: commitDetails.patch,
        diffMetadata: {
          originalBytes: Buffer.byteLength(commitDetails.patch, "utf8"),
          includedBytes: Buffer.byteLength(commitDetails.patch, "utf8"),
          truncated: false,
        },
        characteristics: {
          hasTests: commitDetails.changedFiles.some((f) => f.path.includes("test")),
          hasDocumentation: commitDetails.changedFiles.some((f) => f.path.endsWith(".md")),
          hasConfiguration: false,
          hasDependencies: false,
          hasBinaryChanges: false,
        },
        intelligence: {
          recommendedTypes: [],
          recommendedScopes: [],
          confidence: "high",
        },
      };
    } else if (!messageToCheck) {
      // Target was not a commit revision, treat it as the message string
      messageToCheck = target;
    }
  }

  // If still no message, try .git/COMMIT_EDITMSG
  if (!messageToCheck) {
    try {
      const editMsgPath = path.join(repoRoot, ".git", "COMMIT_EDITMSG");
      const editMsg = await fs.readFile(editMsgPath, "utf8");
      if (editMsg.trim().length > 0) {
        messageToCheck = editMsg;
      }
    } catch {
      // ignore
    }
  }

  // If still no message, check staged changes
  if (!changeContext) {
    const stagedExists = await hasStagedChanges(repoRoot);
    if (stagedExists) {
      changeContext = await buildChangeContext(repoRoot, {
        configuredScopes: config.commit.scopes,
        strictScopes: config.commit.strictScopes,
      });
    }
  }

  if (!messageToCheck) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "MISSING_COMMIT_MESSAGE",
              message: "No commit message provided or found in .git/COMMIT_EDITMSG.",
            },
          },
          null,
          2,
        ),
      );
      process.exit(2);
    }
    printHeader();
    console.error(
      ` ${colors.red}Error: No commit message specified.${colors.reset}\n Provide a message via 'gitwhisper check "message"', '-m "message"', or inspect a commit like 'gitwhisper check HEAD'.\n`,
    );
    process.exit(2);
  }

  // Run deterministic quality check
  let result = await checkCommitQuality({
    message: messageToCheck,
    policy,
    changeContext,
    branchContext,
    strict: options.strict,
  });

  // Optional AI advisory review
  if (options.ai) {
    try {
      const { createProvider } = await import("@gitwhisper/ai");
      const provider = createProvider(config);
      result = await reviewQualityWithAI(result, {
        message: messageToCheck,
        changeContext,
        aiProvider: provider,
      });
    } catch {
      // AI review errors fail safely
    }
  }

  // Handle JSON output
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    const passesStrict = options.strict
      ? result.valid && (result.rating === "excellent" || result.rating === "good")
      : result.valid && result.rating !== "poor";
    process.exit(passesStrict ? 0 : 1);
  }

  // Human-readable terminal output
  printHeader();

  if (isReviewingExistingCommit) {
    console.log(
      ` ${colors.dim}Target commit:${colors.reset} ${colors.bold}${commitIsh}${colors.reset}`,
    );
  }
  console.log(
    ` ${colors.dim}Repository policy:${colors.reset} ${colors.cyan}${policy.style}${colors.reset}`,
  );
  console.log(
    ` ${colors.dim}Commit message:${colors.reset}\n   ${colors.bold}${result.rawMessage}${colors.reset}\n`,
  );

  console.log(` ${colors.bold}Checks:${colors.reset}`);
  for (const check of result.checks) {
    const icon = check.passed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const msg = check.message ? ` ${colors.dim}(${check.message})${colors.reset}` : "";
    console.log(`   ${icon} ${check.name}${msg}`);
  }

  console.log();
  const ratingColor =
    result.rating === "excellent"
      ? colors.green
      : result.rating === "good"
        ? colors.cyan
        : result.rating === "needs-improvement"
          ? colors.yellow
          : colors.red;

  const ratingLabel =
    result.rating === "excellent"
      ? "Excellent"
      : result.rating === "good"
        ? "Good"
        : result.rating === "needs-improvement"
          ? "Needs Improvement"
          : "Poor";

  console.log(
    ` ${colors.bold}Quality Rating:${colors.reset} ${ratingColor}${colors.bold}${ratingLabel}${colors.reset} ${colors.dim}(Score: ${result.score}/100)${colors.reset}\n`,
  );

  if (result.issues.length > 0) {
    console.log(` ${colors.bold}Problems:${colors.reset}`);
    for (const issue of result.issues) {
      const sevColor =
        issue.severity === "error"
          ? colors.red
          : issue.severity === "warning"
            ? colors.yellow
            : colors.blue;
      console.log(`   • ${sevColor}[${issue.severity}]${colors.reset} ${issue.message}`);
      if (issue.evidence && issue.evidence.length > 0) {
        console.log(`     ${colors.dim}Evidence: ${issue.evidence.join(", ")}${colors.reset}`);
      }
    }
    console.log();
  }

  if (result.suggested && result.rating !== "excellent") {
    console.log(` ${colors.bold}Suggested:${colors.reset}`);
    console.log(`   ${colors.green}${result.suggested.subject}${colors.reset}`);
    if (result.suggested.body) {
      console.log(
        `\n   ${colors.dim}${result.suggested.body.replace(/\n/g, "\n   ")}${colors.reset}`,
      );
    }
    console.log();
  }

  const isAccepted = options.strict
    ? result.valid && (result.rating === "excellent" || result.rating === "good")
    : result.valid && result.rating !== "poor";

  if (isAccepted) {
    console.log(` ${colors.green}✓ Commit message meets quality criteria.${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(` ${colors.red}✗ Commit message failed quality policy.${colors.reset}\n`);
    process.exit(1);
  }
}
