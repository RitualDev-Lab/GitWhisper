import { loadConfig } from "@gitwhisper/config";
import {
  buildChangeContext,
  createWorkItemProvider,
  evaluateIntentRelevance,
  findPrimaryRemote,
  globalWorkItemCache,
  normalizeHost,
  parseBranchContext,
} from "@gitwhisper/core";
import {
  findRepository,
  getGitRemotes,
  getRepositoryInfo,
  hasStagedChanges,
} from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface IssueOptions {
  json?: boolean;
}

export async function runIssue(explicitKey?: string, options: IssueOptions = {}): Promise<void> {
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
      process.exit(1);
    }
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    process.exit(1);
  }

  const repo = await getRepositoryInfo(repoRoot);
  const remotes = await getGitRemotes(repoRoot);
  const primaryRemote = findPrimaryRemote(remotes);
  const config = await loadConfig({}, repoRoot);

  const branchContext = parseBranchContext(repo.branch, config.workItems.patterns);

  // References: either explicit key or detected from branch
  const references = [...branchContext.references];
  if (explicitKey) {
    references.unshift({
      raw: explicitKey,
      key: explicitKey,
      source: "user",
      confidence: "high",
    });
  }

  const primaryRef = references[0];
  let workItem = undefined;
  let providerId = primaryRef?.providerHint ?? "generic";

  if (primaryRef) {
    const provider = createWorkItemProvider({
      reference: primaryRef,
      config: config.workItems,
      remote: primaryRemote,
    });
    providerId = provider.id;

    // Check cache
    const host = primaryRemote?.host ?? "generic";
    const projectOrRepo = primaryRemote?.repository ?? "default";
    const cacheKey = globalWorkItemCache.buildKey(provider.id, host, projectOrRepo, primaryRef.key);
    workItem = globalWorkItemCache.get(cacheKey);

    if (!workItem) {
      const resolution = await provider.resolve(primaryRef);
      if (resolution.found && resolution.workItem) {
        workItem = resolution.workItem;
        globalWorkItemCache.set(cacheKey, workItem);
      }
    }
  }

  // Staged change relevance evaluation
  let relevance = "unknown";
  let evidence: Array<{ signal: string; description: string }> = [];

  const staged = await hasStagedChanges(repoRoot);
  if (staged) {
    const changeContext = await buildChangeContext(repoRoot);
    const relResult = evaluateIntentRelevance(workItem, branchContext, changeContext);
    relevance = relResult.relevance;
    evidence = relResult.evidence;
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          branch: branchContext.name ?? null,
          detached: branchContext.detached,
          references: references.map((r) => ({
            key: r.key,
            raw: r.raw,
            source: r.source,
            provider: r.providerHint ?? providerId,
            confidence: r.confidence,
          })),
          workItem: workItem
            ? {
                key: workItem.key,
                provider: workItem.provider,
                title: workItem.title,
                state: workItem.state,
                url: workItem.url,
                labels: workItem.labels,
              }
            : null,
          relevance,
          evidence,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Human-readable terminal output
  printHeader();
  console.log(` ${colors.bold}Branch Intelligence & Work-Item Context${colors.reset}\n`);

  console.log(`   ${colors.dim}Branch:${colors.reset}    ${branchContext.name ?? "(none)"}`);
  if (branchContext.normalizedDescription) {
    console.log(`   ${colors.dim}Hint:${colors.reset}      ${branchContext.normalizedDescription}`);
  }

  if (references.length === 0) {
    console.log(
      `\n   ${colors.yellow}No work-item references detected in current branch.${colors.reset}`,
    );
    console.log("   Tip: Pass an explicit issue key: `gitwhisper issue DEV-142`\n");
    return;
  }

  console.log(`\n   ${colors.bold}Detected References:${colors.reset}`);
  for (const ref of references) {
    console.log(
      `   • ${colors.cyan}${ref.key}${colors.reset} (${ref.source}, ${ref.confidence} confidence)`,
    );
  }

  if (workItem) {
    console.log(`\n   ${colors.bold}Work Item Details:${colors.reset}`);
    console.log(
      `   ${colors.dim}Key:${colors.reset}       ${colors.green}${workItem.key}${colors.reset}`,
    );
    console.log(`   ${colors.dim}Provider:${colors.reset}  ${workItem.provider}`);
    if (workItem.title) {
      console.log(`   ${colors.dim}Title:${colors.reset}     ${workItem.title}`);
    }
    if (workItem.state) {
      console.log(`   ${colors.dim}State:${colors.reset}     ${workItem.state}`);
    }
    if (workItem.labels && workItem.labels.length > 0) {
      console.log(`   ${colors.dim}Labels:${colors.reset}    ${workItem.labels.join(", ")}`);
    }
    if (workItem.url) {
      console.log(`   ${colors.dim}URL:${colors.reset}       ${workItem.url}`);
    }
  }

  if (staged) {
    const relColor =
      relevance === "high" ? colors.green : relevance === "medium" ? colors.yellow : colors.dim;
    console.log(
      `\n   ${colors.bold}Staged Relevance:${colors.reset} ${relColor}${relevance.toUpperCase()}${colors.reset}`,
    );
    for (const ev of evidence) {
      console.log(`   • ${ev.description}`);
    }
  } else {
    console.log(
      `\n   ${colors.dim}(No staged changes currently to evaluate relevance)${colors.reset}`,
    );
  }

  console.log("");
}
