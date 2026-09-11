import readline from "node:readline";
import {
  type MultiVariantGenerationResult,
  createProvider,
  generateVariants,
  getPrivacyBadge,
} from "@gitwhisper/ai";
import { type ConfigOverrides, loadConfig } from "@gitwhisper/config";
import {
  type CommitComposerSession,
  type CommitProposal,
  type CommitVariant,
  type CommitVariantStyle,
  type HunkCommitPlan,
  PrivacyPolicyBlockedError,
  type ProviderSafeContext,
  analyzeRepositoryHistory,
  applyComposerOverrides,
  buildChangeContext,
  buildHunkCommitPlan,
  computeHistoryCacheKey,
  formatCommitSubject,
  getCachedHistoryProfile,
  prepareProviderContext,
  resolveCommitStyle,
  sanitizeTerminalString,
  scanCommitMessage,
  setCachedHistoryProfile,
  switchVariant,
  transitionComposer,
  validateCommitProposal,
  createWorkItemProvider,
  evaluateIntentRelevance,
  findPrimaryRemote,
  globalWorkItemCache,
  insertReferenceIntoMessage,
  parseBranchContext,
  sanitizeWorkItemForAI,
  type IssueReferencePolicy,
  type WorkItem,
  type WorkItemReference,
} from "@gitwhisper/core";
import {
  commitStagedChanges,
  findRepository,
  getCommitHistory,
  getGitRemotes,
  hasStagedChanges,
  isShallowRepository,
} from "@gitwhisper/git";
import { copyToClipboard } from "../ui/clipboard.js";
import { renderComposerDashboard } from "../ui/composer-terminal.js";
import { showCommitDetails } from "../ui/details.js";
import { editCommitMessage } from "../ui/editor.js";
import { pickCommitScope, pickCommitType, toggleBreakingChange } from "../ui/overrides.js";
import { promptPrivacyReview } from "../ui/privacy-prompt.js";
import { promptWorkItemReview } from "../ui/work-item-prompt.js";
import { colors, printHeader } from "../ui/terminal.js";
import { runSplit } from "./split.js";

export interface GenerateOptions extends ConfigOverrides {
  dryRun?: boolean;
  noBody?: boolean;
  noHistory?: boolean;
  noSplit?: boolean;
  json?: boolean;
  quiet?: boolean;
  variant?: CommitVariantStyle;
  editor?: string;
  noColor?: boolean;
  issue?: string;
  workItem?: string;
  noWorkItem?: boolean;
}

export async function runGenerate(options: GenerateOptions = {}): Promise<void> {
  const repoRoot = await findRepository();

  if (!repoRoot) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "NOT_A_GIT_REPOSITORY",
              message: "Not inside a Git repository.",
              advice: "Run git init or navigate to a repository directory.",
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
    console.error(" Initialize a repository first:\n   git init\n");
    process.exit(1);
  }

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "EMPTY_STAGING_AREA",
              message: "No staged changes found.",
              advice: "Stage files first using `git add <files>`.",
            },
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    printHeader();
    console.log(" No staged changes found.\n");
    console.log(" Stage files first:\n");
    console.log("   git add <files>\n");
    console.log(" Then run GitWhisper again.\n");
    process.exit(1);
  }

  const config = await loadConfig(options, repoRoot);
  if (options.noHistory) {
    config.history.enabled = false;
  }
  const provider = createProvider(config);
  const privacy = getPrivacyBadge(provider);

  const isInteractive = process.stdout.isTTY && !options.json && !options.quiet;

  const totalStartTime = Date.now();
  const contextStartTime = Date.now();
  let context = await buildChangeContext(repoRoot, {
    configuredScopes: config.commit.scopes,
    strictScopes: config.commit.strictScopes,
  });
  const contextMs = Date.now() - contextStartTime;

  // Phase 7 Privacy Boundary Enforcement
  let safeContext: ProviderSafeContext;
  try {
    safeContext = await prepareProviderContext({
      changeContext: context,
      privacyConfig: config.privacy,
      baseUrl: provider.baseUrl,
    });
  } catch (err: any) {
    if (err instanceof PrivacyPolicyBlockedError) {
      if (!isInteractive) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                error: {
                  code: "PRIVACY_POLICY_BLOCKED",
                  message:
                    "Staged changes contain sensitive credentials blocked by privacy policy.",
                  findings: err.findings.map((f) => ({
                    ...f,
                    matchedText: undefined,
                  })),
                },
              },
              null,
              2,
            ),
          );
          process.exit(1);
        }
        printHeader();
        console.error(`\n ${colors.red}Error: Privacy Policy Blocked${colors.reset}\n`);
        console.error(
          ` Sensitive credentials detected in staged changes for ${provider.isLocal ? "local" : "remote"} provider (${provider.baseUrl}).\n`,
        );
        for (const f of err.findings) {
          console.error(
            `  • [${f.confidence.toUpperCase()}] ${f.filePath}:${f.lineNumber} (${f.lineType}): ${f.maskedPreview} (${f.description ?? f.category})`,
          );
        }
        console.error(
          "\n Run `gitwhisper privacy scan` for details, or unstage sensitive files.\n",
        );
        process.exit(1);
      }

      const choice = await promptPrivacyReview(err.findings, provider, context);
      if (choice === "cancel") {
        console.log("\n Commit cancelled by developer.\n");
        process.exit(0);
      }

      safeContext = await prepareProviderContext({
        changeContext: context,
        privacyConfig: config.privacy,
        baseUrl: provider.baseUrl,
        allowRedactionOnBlock: true,
      });
    } else {
      throw err;
    }
  }

  // Use the certified sanitized context for AI generation
  context = safeContext.changeContext;

  // History Analysis & Caching
  let historyProfile = analyzeRepositoryHistory([]);
  if (config.history.enabled) {
    const isShallow = await isShallowRepository(repoRoot);
    const limit = config.history.limit;
    const cacheKey = computeHistoryCacheKey(repoRoot, null, `limit=${limit}`);
    const cached = await getCachedHistoryProfile(cacheKey);

    if (cached) {
      historyProfile = cached;
    } else {
      const commits = await getCommitHistory(repoRoot, {
        limit,
        includeMerges: config.history.includeMergeCommits,
        withFiles: config.history.learnScopes,
      });

      historyProfile = analyzeRepositoryHistory(commits, {
        minimumSampleSize: config.history.minimumSampleSize,
        includeMergeCommits: config.history.includeMergeCommits,
        isShallow,
      });

      if (commits.length > 0) {
        const head = commits[0]?.hash ?? null;
        const realKey = computeHistoryCacheKey(repoRoot, head, `limit=${limit}`);
        await setCachedHistoryProfile(realKey, historyProfile);
      }
    }
  }

  // Style Resolution
  let resolvedStyle = resolveCommitStyle({
    config: {
      ...config.commit,
      learnScopes: config.history.learnScopes,
      learnFormatting: config.history.learnFormatting,
    },
    context,
    historyProfile,
  });

  let hunkPlan: HunkCommitPlan | undefined;
  if (config.planning.enabled && config.planning.suggestSplit && !options.noSplit) {
    try {
      hunkPlan = await buildHunkCommitPlan(repoRoot, context, config.planning);
    } catch {
      // ignore plan failures in standard flow
    }
  }

  // Top deterministic candidates
  const topType = context.intelligence.probableTypes[0] || {
    type: "chore",
    score: 0.1,
    reasons: ["Default candidate"],
    confidence: "LOW",
  };
  const topScope = context.intelligence.probableScopes[0] || {
    scope: "none",
    score: 0.1,
    reasons: ["No specific scope identified"],
    confidence: "LOW",
  };

  // Work-Item & Branch Intelligence
  const branchContext = parseBranchContext(context.repository.branch, config.workItems.patterns);

  let selectedReference: WorkItemReference | undefined;
  const explicitIssue = options.issue || options.workItem;
  if (explicitIssue) {
    selectedReference = {
      raw: explicitIssue,
      key: explicitIssue,
      source: "user",
      confidence: "high",
    };
  } else if (
    !options.noWorkItem &&
    config.workItems.enabled &&
    config.workItems.autoDetectFromBranch
  ) {
    if (branchContext.references.length > 0) {
      selectedReference = branchContext.references[0];
    }
  }

  let resolvedWorkItem: WorkItem | undefined;
  let relevance = "unknown";

  if (selectedReference) {
    const remotes = await getGitRemotes(repoRoot);
    const primaryRemote = findPrimaryRemote(remotes);
    const providerObj = createWorkItemProvider({
      reference: selectedReference,
      config: config.workItems,
      remote: primaryRemote,
    });

    const host = primaryRemote?.host ?? "generic";
    const projectOrRepo = primaryRemote?.repository ?? "default";
    const cacheKey = globalWorkItemCache.buildKey(
      providerObj.id,
      host,
      projectOrRepo,
      selectedReference.key,
    );
    resolvedWorkItem = globalWorkItemCache.get(cacheKey);

    if (!resolvedWorkItem && (config.workItems.autoFetch || explicitIssue)) {
      try {
        const resolution = await providerObj.resolve(selectedReference);
        if (resolution.found && resolution.workItem) {
          resolvedWorkItem = resolution.workItem;
          globalWorkItemCache.set(cacheKey, resolvedWorkItem);
        }
      } catch {
        // Offline / error resilience
      }
    }

    const relResult = evaluateIntentRelevance(resolvedWorkItem, branchContext, context);
    relevance = relResult.relevance;
  }

  let currentPolicy: IssueReferencePolicy = {
    mode: config.workItems.defaultReferenceMode,
    referenceKeyword: config.workItems.referenceKeyword,
    closingKeyword: config.workItems.closingKeyword,
    placement: config.workItems.placement,
  };

  async function fetchMultiVariants(
    forcedType?: string,
    forcedScope?: string,
  ): Promise<{ result: MultiVariantGenerationResult; durationMs: number }> {
    if (isInteractive) {
      process.stdout.write(
        ` ${colors.dim}Analyzing staged changes with ${provider.id}...${colors.reset}\r`,
      );
    }
    const genStart = Date.now();

    let workItemContext = undefined;
    if (selectedReference) {
      if (resolvedWorkItem) {
        workItemContext = await sanitizeWorkItemForAI(resolvedWorkItem, config.privacy);
      } else {
        workItemContext = { reference: selectedReference.key };
      }
    }

    const result = await generateVariants(provider, {
      repository: {
        name: context.repository.name,
        branch: context.repository.branch,
      },
      files: context.files,
      stats: {
        additions: context.stats.additions,
        deletions: context.stats.deletions,
      },
      patch: context.patch,
      characteristics: context.characteristics,
      allowedTypes: resolvedStyle.allowedTypes,
      suggestedScopes: resolvedStyle.suggestedScopes,
      forcedType,
      forcedScope,
      workItemContext,
      styleContext: {
        style: forcedType ? "conventional" : resolvedStyle.effectiveStyle,
        subjectCase: resolvedStyle.subjectCase,
        preferBody: resolvedStyle.preferBody,
        subjectTargetLength: resolvedStyle.targetLength,
        commonScopes: resolvedStyle.suggestedScopes,
        representativeExamples: config.history.sendExamplesToAI
          ? resolvedStyle.representativeExamples
          : undefined,
      },
    });

    const durationMs = Date.now() - genStart;
    return { result, durationMs };
  }

  const { result: variantResult, durationMs: generationMs } = await fetchMultiVariants();

  if (options.noBody) {
    for (const style of ["concise", "descriptive", "detailed"] as const) {
      if (variantResult.variants[style]) {
        variantResult.variants[style].body = undefined;
      }
    }
  }

  const isSimpleStyle = resolvedStyle.effectiveStyle === "simple";
  const defaultVariantStyle: CommitVariantStyle =
    options.variant || config.composer.defaultVariant || "descriptive";

  const styles: CommitVariantStyle[] = ["concise", "descriptive", "detailed"];
  const buildVariantsList = (vRes: MultiVariantGenerationResult): CommitVariant[] => {
    return styles.map((style) => {
      const content = vRes.variants[style];
      const proposal: CommitProposal = {
        type: isSimpleStyle ? "simple" : vRes.type || topType.type,
        scope: isSimpleStyle
          ? undefined
          : vRes.scope && vRes.scope !== "none"
            ? vRes.scope
            : topScope.scope === "none"
              ? undefined
              : topScope.scope,
        description: content.description,
        body: content.body,
        breaking: vRes.breaking,
        breakingDescription: vRes.breakingDescription,
        confidence: {
          type: isSimpleStyle ? "HIGH" : topType.confidence,
          scope: isSimpleStyle ? "LOW" : topScope.confidence,
        },
        evidence: {
          typeReasons: Array.from(new Set([...topType.reasons, ...vRes.reasoning])),
          scopeReasons: topScope.reasons,
          signals: context.intelligence.signals,
        },
      };

      let subject = isSimpleStyle ? content.description : formatCommitSubject(proposal);
      let body = content.body;

      if (selectedReference && currentPolicy.mode !== "none") {
        if (currentPolicy.placement === "subject") {
          subject = insertReferenceIntoMessage(
            subject,
            selectedReference.key,
            currentPolicy,
            "subject",
          );
        } else if (style !== "concise" || currentPolicy.mode === "close") {
          body = insertReferenceIntoMessage(
            body ?? "",
            selectedReference.key,
            currentPolicy,
            "footer",
          );
        }
      }

      const validation = validateCommitProposal(proposal, config.commit);

      return {
        id: style,
        style,
        subject,
        body,
        proposal,
        validation,
      };
    });
  };

  let session: CommitComposerSession = {
    id: `session-${Date.now()}`,
    repository: {
      root: repoRoot,
      name: context.repository.name,
      branch: context.repository.branch,
      isDetached: false,
      hasCommits: true,
      stagedCount: context.files.length,
      unstagedCount: 0,
      untrackedCount: 0,
    },
    changeContext: context,
    plan: hunkPlan,
    variants: buildVariantsList(variantResult),
    selectedVariantId: defaultVariantStyle,
    overrides: {},
    evidence: resolvedStyle.provenance || [],
    timing: {
      gitAnalysisMs: contextMs,
      intelligenceMs: 0,
      providerMs: generationMs,
      totalMs: Date.now() - totalStartTime,
    },
    provider: {
      id: provider.id,
      model: provider.model,
      isLocal: provider.isLocal,
      privacyLabel: privacy.isLocal ? "Local" : "Remote",
    },
    state: "reviewing",
  };

  // 1. JSON output mode (--json)
  if (options.json) {
    const active =
      session.variants.find((v) => v.id === session.selectedVariantId) || session.variants[0];
    const output = {
      repository: session.repository,
      provider: session.provider,
      timing: session.timing,
      selectedVariant: session.selectedVariantId,
      subject: active.subject,
      body: active.body,
      type: active.proposal.type,
      scope: active.proposal.scope,
      breaking: active.proposal.breaking,
      breakingDescription: active.proposal.breakingDescription,
      workItem: selectedReference
        ? {
            key: selectedReference.key,
            relevance,
            source: selectedReference.source,
          }
        : null,
      variants: session.variants,
      hunkPlan: hunkPlan
        ? {
            isSingleConcern: hunkPlan.isSingleConcern,
            groupCount: hunkPlan.groups.length,
            totalHunks: hunkPlan.totalHunks,
          }
        : undefined,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // 2. Dry-run mode
  if (options.dryRun) {
    renderComposerDashboard(session, {
      hasSplitSuggestion: Boolean(hunkPlan && !hunkPlan.isSingleConcern),
      splitCount: hunkPlan?.groups.length,
      workItemKey: selectedReference?.key,
      workItemTitle: resolvedWorkItem?.title,
      workItemRelevance: relevance,
    });
    console.log(` ${colors.yellow}[Dry run] No commit was created.${colors.reset}\n`);
    return;
  }

  // 3. Quiet or Explicit Piped mode (e.g. gitwhisper generate | pbcopy or --quiet)
  const isPipedCommand = process.argv.includes("generate") && !process.stdout.isTTY;
  if (options.quiet || isPipedCommand || (!process.stdout.isTTY && process.stdin.isTTY)) {
    const active =
      session.variants.find((v) => v.id === session.selectedVariantId) || session.variants[0];
    const fullMessage = active.body ? `${active.subject}\n\n${active.body}` : active.subject;
    process.stdout.write(`${fullMessage}\n`);
    return;
  }

  // 4. Interactive Keyboard-First Composer Loop
  let statusMsg: string | undefined;
  let errorMsg: string | undefined;

  while (session.state === "reviewing") {
    const activeVariant =
      session.variants.find((v) => v.id === session.selectedVariantId) || session.variants[0];
    const validation = validateCommitProposal(activeVariant.proposal, config.commit);

    renderComposerDashboard(session, {
      hasSplitSuggestion: Boolean(hunkPlan && !hunkPlan.isSingleConcern),
      splitCount: hunkPlan?.groups.length,
      validationErrors: validation.errors.map((e) => e.message),
      validationWarnings: validation.warnings.map((w) => w.message),
      statusMessage: statusMsg,
      errorMessage: errorMsg,
      workItemKey: selectedReference?.key,
      workItemTitle: resolvedWorkItem?.title,
      workItemRelevance: relevance,
    });

    statusMsg = undefined;
    errorMsg = undefined;

    const key = await readSingleKeypress();

    if (key === "return" || key === "enter") {
      if (!validation.valid) {
        errorMsg = "Cannot commit: Resolve validation errors first (e.g. edit subject or type).";
        continue;
      }

      // Scan commit message before committing to prevent secret leaks into git history
      const commitScan = await scanCommitMessage(activeVariant.subject, activeVariant.body, {
        stagedFindings: safeContext.findings,
      });
      if (!commitScan.safe) {
        errorMsg = `Cannot commit: Message contains sensitive credentials or unresolved placeholders (${commitScan.reasons.join("; ")})`;
        continue;
      }

      try {
        session = transitionComposer(session, "committing");
        const commitResult = await commitStagedChanges(repoRoot, {
          subject: activeVariant.subject,
          body: activeVariant.body,
        });
        session = transitionComposer(session, "completed");
        console.log(`\n ${colors.green}✓${colors.reset} Commit created\n`);
        console.log(
          ` ${colors.bold}${commitResult.commitHash}${colors.reset} ${sanitizeTerminalString(activeVariant.subject)}\n`,
        );
        return;
      } catch (err: any) {
        console.error(`\n ${colors.red}Commit failed:${colors.reset} ${err.message}\n`);
        process.exit(1);
      }
    }

    if (key === "1") {
      session = switchVariant(session, "concise");
      statusMsg = "Switched to Concise variant.";
      continue;
    }

    if (key === "2") {
      session = switchVariant(session, "descriptive");
      statusMsg = "Switched to Descriptive variant.";
      continue;
    }

    if (key === "3") {
      session = switchVariant(session, "detailed");
      statusMsg = "Switched to Detailed variant.";
      continue;
    }

    if (key === "i") {
      const reviewResult = await promptWorkItemReview(
        selectedReference,
        resolvedWorkItem,
        currentPolicy,
        relevance,
      );
      selectedReference = reviewResult.reference;
      currentPolicy = reviewResult.policy;

      session.variants = buildVariantsList(variantResult);
      statusMsg = selectedReference
        ? `Work-item reference set to ${selectedReference.key}.`
        : "Work-item reference removed.";
      continue;
    }

    if (key === "t") {
      const chosenType = await pickCommitType(
        config.commit.allowedTypes,
        activeVariant.proposal.type,
      );
      session = applyComposerOverrides(session, { type: chosenType });
      statusMsg = `Commit type updated to "${chosenType}".`;
      continue;
    }

    if (key === "s") {
      const chosenScope = await pickCommitScope(
        context.intelligence.probableScopes.map((s) => s.scope),
        activeVariant.proposal.scope,
      );
      session = applyComposerOverrides(session, { scope: chosenScope });
      statusMsg = chosenScope ? `Scope updated to "${chosenScope}".` : "Scope cleared.";
      continue;
    }

    if (key === "b") {
      const toggle = await toggleBreakingChange(activeVariant.proposal.breaking);
      session = applyComposerOverrides(session, {
        breaking: toggle.breaking,
      });
      statusMsg = toggle.breaking ? "Breaking change flag set." : "Breaking change flag cleared.";
      continue;
    }

    if (key === "e") {
      session = transitionComposer(session, "editing");
      const edited = await editCommitMessage(
        {
          subject: activeVariant.subject,
          body: activeVariant.body,
        },
        { editor: options.editor || config.composer.editor },
      );

      // Scan manually edited message to ensure no secrets or placeholders are introduced
      const editScan = await scanCommitMessage(edited.subject, edited.body, {
        stagedFindings: safeContext.findings,
      });
      if (!editScan.safe) {
        errorMsg = `Edited message rejected: Contains sensitive credentials or unresolved placeholders (${editScan.reasons.join("; ")})`;
        session = transitionComposer(session, "reviewing");
        continue;
      }

      session = applyComposerOverrides(session, {
        manualSubject: edited.subject,
        manualBody: edited.body,
      });
      session = transitionComposer(session, "reviewing");
      statusMsg = "Commit message updated.";
      continue;
    }

    if (key === "r") {
      session = transitionComposer(session, "regenerating");
      try {
        const refreshed = await fetchMultiVariants(
          activeVariant.proposal.type,
          activeVariant.proposal.scope,
        );
        session.variants = buildVariantsList(refreshed.result);
        session.timing.providerMs = refreshed.durationMs;
        statusMsg = "Regenerated message variants.";
      } catch (err: any) {
        errorMsg = `Regeneration failed: ${err.message}`;
      }
      session = transitionComposer(session, "reviewing");
      continue;
    }

    if (key === "a") {
      session = transitionComposer(session, "regenerating");
      try {
        context = await buildChangeContext(repoRoot, {
          configuredScopes: config.commit.scopes,
          strictScopes: config.commit.strictScopes,
        });
        resolvedStyle = resolveCommitStyle({
          config: {
            ...config.commit,
            learnScopes: config.history.learnScopes,
            learnFormatting: config.history.learnFormatting,
          },
          context,
          historyProfile,
        });
        const refreshed = await fetchMultiVariants();
        session.changeContext = context;
        session.variants = buildVariantsList(refreshed.result);
        session.repository.stagedCount = context.files.length;
        statusMsg = "Re-analyzed staged changes and generated fresh variants.";
      } catch (err: any) {
        errorMsg = `Re-analysis failed: ${err.message}`;
      }
      session = transitionComposer(session, "reviewing");
      continue;
    }

    if (key === "d") {
      await showCommitDetails(context, activeVariant.proposal, resolvedStyle.provenance);
      continue;
    }

    if (key === "p") {
      if (hunkPlan && !hunkPlan.isSingleConcern) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((res) => {
          rl.question(
            `\n Multi-concern detected (${hunkPlan!.groups.length} groups). [1] Inspect Patch  [2] Split into Commits  [Return to Composer]: `,
            (ans) => {
              rl.close();
              res(ans.trim());
            },
          );
        });

        if (answer === "2") {
          await runSplit({ hunkPlan });
          return;
        }
      }

      // Display staged patch diff preview
      console.log(
        `\n ${colors.bold}Staged Patch Preview (${context.files.length} files):${colors.reset}\n`,
      );
      const lines = context.patch.split("\n");
      const previewLines = lines.slice(0, 30);
      for (const line of previewLines) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          console.log(`  ${colors.green}${line}${colors.reset}`);
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          console.log(`  ${colors.red}${line}${colors.reset}`);
        } else if (line.startsWith("@@")) {
          console.log(`  ${colors.cyan}${line}${colors.reset}`);
        } else {
          console.log(`  ${colors.dim}${line}${colors.reset}`);
        }
      }
      if (lines.length > 30) {
        console.log(
          `  ${colors.dim}... [${lines.length - 30} more lines truncated]${colors.reset}`,
        );
      }
      console.log(`\n ${colors.dim}Press any key to return to composer...${colors.reset}`);
      await readSingleKeypress();
      continue;
    }

    if (key === "c") {
      const fullText = activeVariant.body
        ? `${activeVariant.subject}\n\n${activeVariant.body}`
        : activeVariant.subject;
      const copied = await copyToClipboard(fullText);
      if (copied) {
        statusMsg = "Copied commit message to clipboard.";
      } else {
        errorMsg =
          "Could not access system clipboard. You can copy text directly from the terminal.";
      }
      continue;
    }

    if (key === "q") {
      session = transitionComposer(session, "cancelled");
      console.log(`\n ${colors.dim}Commit cancelled. No changes were committed.${colors.reset}\n`);
      return;
    }
  }
}

/**
 * Reads a single keypress from standard input in raw mode.
 */
function readSingleKeypress(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      if (process.stdin.readableEnded || process.stdin.destroyed) {
        resolve("enter");
        return;
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      let answered = false;
      rl.on("close", () => {
        if (!answered) {
          answered = true;
          resolve("enter");
        }
      });
      rl.question("> ", (ans) => {
        if (!answered) {
          answered = true;
          rl.close();
          const trimmed = ans.trim().toLowerCase();
          if (!trimmed || trimmed === "") {
            resolve("enter");
          } else {
            resolve(trimmed);
          }
        }
      });
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      cleanup();
      const name = (key.name || "").toLowerCase();
      if (name === "return" || name === "enter") {
        resolve("enter");
      } else if (str) {
        resolve(str.toLowerCase());
      } else {
        resolve(name);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}
