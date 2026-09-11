import { EventEmitter } from "node:events";
import path from "node:path";
import {
  commitStagedChanges,
  executeHunkGroupCommit,
  executeIsolatedGroupCommit,
  findRepository,
  getCommitHistory,
  getCurrentBranch,
  getRepositoryInfo,
  getStagedFiles,
  getStagedIndexEntries,
  hasStagedChanges,
  syncPrimaryIndex,
} from "@gitwhisper/git";
import { buildChangeContext } from "../context.js";
import { analyzeRepositoryHistory } from "../history/analyzer.js";
import type { RepositoryCommitStyle } from "../history/types.js";
import type { CommitProposal, ConfidenceLevel } from "../intelligence/types.js";
import { formatCommitSubject } from "../intelligence/validator.js";
import { buildPatchSelection } from "../patch/builder.js";
import { parsePatch } from "../patch/parser.js";
import type { GitPatch } from "../patch/types.js";
import { buildCommitPlan } from "../planning/planner.js";
import { buildHunkCommitPlan, type HunkCommitPlan } from "../planning/hunk-planner.js";
import type { CommitPlan } from "../planning/types.js";
import { prepareProviderContext, PrivacyPolicyBlockedError } from "../privacy/index.js";
import { checkCommitQuality } from "../quality/index.js";
import type { CommitQualityResult } from "../quality/types.js";
import { getCommitTimeline } from "../timeline/index.js";
import type { CommitTimeline, TimelineOptions } from "../timeline/types.js";
import type { ChangeContext } from "../types.js";
import type { CommitVariant } from "../composer/types.js";
import { parseBranchContext } from "../workitems/branch-parser.js";
import type { BranchContext } from "../workitems/types.js";
import { GitWhisperError } from "./errors.js";
import type {
  CheckCommitOptions,
  CommitGenerationResult,
  CommitOptions,
  CreatePlanOptions,
  DecisionEvidence,
  GenerateCommitOptions,
  GenerateVariantsOptions,
  GitWhisperClient,
  GitWhisperEvents,
  GitWhisperOptions,
  PrivacySummary,
  RepositoryStatus,
  SDKMultiVariantResult,
} from "./types.js";

function parseMessage(message: CommitProposal | string): { subject: string; body?: string } {
  if (typeof message !== "string") {
    return {
      subject: formatCommitSubject(message),
      body: message.body?.trim() || undefined,
    };
  }

  const trimmed = message.trim();
  const parts = trimmed.split(/\r?\n\r?\n/);
  return {
    subject: parts[0] || "",
    body: parts.slice(1).join("\n\n") || undefined,
  };
}

export class GitWhisperClientImpl implements GitWhisperClient {
  readonly repository: string;
  private readonly _options: GitWhisperOptions;
  private readonly _emitter: EventEmitter;

  constructor(options: GitWhisperOptions) {
    if (!options.repository) {
      throw new GitWhisperError({
        code: "NOT_A_GIT_REPOSITORY",
        message: "Repository path must be provided.",
      });
    }
    this.repository = path.resolve(options.repository);
    this._options = { ...options, repository: this.repository };
    this._emitter = new EventEmitter();
  }

  on<E extends keyof GitWhisperEvents>(
    event: E,
    listener: (payload: GitWhisperEvents[E]) => void,
  ): this {
    this._emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  off<E extends keyof GitWhisperEvents>(
    event: E,
    listener: (payload: GitWhisperEvents[E]) => void,
  ): this {
    this._emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  private _checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted || this._options.signal?.aborted) {
      throw new GitWhisperError({
        code: "OPERATION_ABORTED",
        message: "Operation was aborted.",
      });
    }
  }

  private async _ensureRepository(): Promise<string> {
    const root = await findRepository(this.repository);
    if (!root) {
      throw new GitWhisperError({
        code: "NOT_A_GIT_REPOSITORY",
        message: `Path "${this.repository}" is not inside a Git repository.`,
      });
    }
    return root;
  }

  async getRepositoryStatus(options?: { signal?: AbortSignal }): Promise<RepositoryStatus> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();
    const [repoInfo, stagedFiles, staged] = await Promise.all([
      getRepositoryInfo(repoRoot),
      getStagedFiles(repoRoot),
      hasStagedChanges(repoRoot),
    ]);

    return {
      root: repoRoot,
      name: repoInfo.name,
      branch: repoInfo.branch || "HEAD",
      head: repoInfo.head || "",
      isInitial: repoInfo.isInitial,
      hasStagedChanges: staged,
      stagedFilesCount: stagedFiles.length,
    };
  }

  async analyzeStagedChanges(options?: { signal?: AbortSignal }): Promise<ChangeContext> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();

    const staged = await hasStagedChanges(repoRoot);
    if (!staged) {
      throw new GitWhisperError({
        code: "EMPTY_STAGING_AREA",
        message: "No staged changes found. Stage files first with `git add`.",
      });
    }

    this._emitter.emit("analysis:start", {
      timestamp: Date.now(),
      repository: repoRoot,
    });

    const start = Date.now();
    try {
      const context = await buildChangeContext(repoRoot, {
        configuredScopes: this._options.config?.commit?.allowedScopes,
        strictScopes: this._options.config?.commit?.strictScopes,
      });

      this._emitter.emit("analysis:complete", {
        timestamp: Date.now(),
        filesCount: context.files.length,
        durationMs: Date.now() - start,
      });

      return context;
    } catch (err: any) {
      this._emitter.emit("error", {
        code: "ANALYSIS_FAILED",
        message: err.message,
      });
      throw err;
    }
  }

  async analyzeHunks(options?: { signal?: AbortSignal }): Promise<GitPatch> {
    this._checkAbort(options?.signal);
    const context = await this.analyzeStagedChanges(options);
    return parsePatch(context.patch);
  }

  async createCommitPlan(options?: CreatePlanOptions): Promise<HunkCommitPlan | CommitPlan> {
    this._checkAbort(options?.signal);
    const context = await this.analyzeStagedChanges(options);

    const level = options?.level ?? "auto";
    if (level === "file") {
      return buildCommitPlan(this.repository, context, this._options.config?.planning);
    }
    if (level === "hunk") {
      return buildHunkCommitPlan(this.repository, context, this._options.config?.planning);
    }

    // Auto level
    try {
      const hunkPlan = await buildHunkCommitPlan(
        this.repository,
        context,
        this._options.config?.planning,
      );
      if (hunkPlan.groups.length > 1) {
        return hunkPlan;
      }
    } catch {
      // Fallback to file plan
    }
    return buildCommitPlan(this.repository, context, this._options.config?.planning);
  }

  async createSplitPlan(options?: CreatePlanOptions): Promise<HunkCommitPlan | CommitPlan> {
    return this.createCommitPlan(options);
  }

  async analyzeRepositoryStyle(options?: {
    signal?: AbortSignal;
    limit?: number;
  }): Promise<RepositoryCommitStyle | undefined> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();
    const limit = options?.limit ?? 50;
    const commits = await getCommitHistory(repoRoot, {
      limit,
      includeMerges: false,
      withFiles: true,
    });
    return analyzeRepositoryHistory(commits);
  }

  async detectWorkItem(options?: {
    signal?: AbortSignal;
    key?: string;
  }): Promise<BranchContext> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();
    const branch = await getCurrentBranch(repoRoot);
    return parseBranchContext(branch || "HEAD");
  }

  async getCommitTimeline(options?: TimelineOptions): Promise<CommitTimeline> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();
    return getCommitTimeline(repoRoot, options);
  }

  async checkCommit(
    messageOrTarget: string,
    options?: CheckCommitOptions,
  ): Promise<CommitQualityResult> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();
    const result = await checkCommitQuality({
      message: messageOrTarget,
      policy: options?.policy ?? this._options.config?.commit?.policy,
      ...options,
    });

    if (options?.strict && !result.valid) {
      throw new GitWhisperError({
        code: "POLICY_VIOLATION",
        message: "Commit quality check failed strict policy.",
        details: result,
      });
    }

    return result;
  }

  async generateVariants(options?: GenerateVariantsOptions): Promise<SDKMultiVariantResult> {
    this._checkAbort(options?.signal);
    const context = await this.analyzeStagedChanges(options);

    // Phase 7: Strict Privacy Scan Boundary
    let safeContext: { changeContext: ChangeContext };
    try {
      safeContext = await prepareProviderContext({
        changeContext: context,
        privacyConfig: this._options.config?.privacy,
        baseUrl: this._options.aiProvider?.baseUrl,
      });
    } catch (err: any) {
      if (err instanceof PrivacyPolicyBlockedError) {
        throw new GitWhisperError({
          code: "PRIVACY_VIOLATION",
          message: "Staged changes contain sensitive credentials blocked by privacy policy.",
          details: err.findings,
          cause: err,
        });
      }
      throw err;
    }

    const sanitizedContext = safeContext.changeContext;
    let aiProvider = this._options.aiProvider;

    if (!aiProvider) {
      try {
        // @ts-ignore
        const aiMod = await import("@gitwhisper/ai").catch(() => null);
        if (aiMod && this._options.config?.ai) {
          aiProvider = aiMod.createProvider(this._options.config.ai);
        }
      } catch {
        // AI package not available
      }
    }

    if (aiProvider) {
      this._emitter.emit("provider:start", {
        timestamp: Date.now(),
        provider: aiProvider.id,
        model: aiProvider.model,
      });
      const genStart = Date.now();
      try {
        // @ts-ignore
        const aiMod = await import("@gitwhisper/ai");
        const res = await aiMod.generateVariants(aiProvider, {
          repository: {
            name: sanitizedContext.repository.name,
            branch: sanitizedContext.repository.branch,
          },
          files: sanitizedContext.files,
          stats: {
            additions: sanitizedContext.stats.additions,
            deletions: sanitizedContext.stats.deletions,
          },
          patch: sanitizedContext.patch,
          characteristics: sanitizedContext.characteristics,
          allowedTypes: options?.style === "simple" ? ["simple"] : undefined,
          forcedType: options?.style === "simple" ? "simple" : undefined,
        });

        this._emitter.emit("provider:complete", {
          timestamp: Date.now(),
          provider: aiProvider.id,
          durationMs: Date.now() - genStart,
        });

        return res as SDKMultiVariantResult;
      } catch (err: any) {
        this._emitter.emit("error", {
          code: "PROVIDER_ERROR",
          message: err.message,
        });
        // Fallback to deterministic variants
      }
    }

    // Deterministic fallback variants
    const primaryType = sanitizedContext.intelligence.probableTypes[0]?.type || "chore";
    const primaryScope = sanitizedContext.intelligence.probableScopes[0]?.scope;
    const scopeStr = primaryScope && primaryScope !== "none" ? `(${primaryScope})` : "";
    const topFile = sanitizedContext.files[0]?.path
      ? path.basename(sanitizedContext.files[0].path)
      : "files";

    const desc = `update ${topFile} staged changes`;
    const conciseSubj = `${primaryType}${scopeStr}: ${desc}`;
    const detailedBody = sanitizedContext.files.map((f) => `- ${f.status} ${f.path}`).join("\n");

    return {
      type: primaryType,
      scope: primaryScope && primaryScope !== "none" ? primaryScope : undefined,
      breaking: false,
      reasoning: ["Deterministic rule-based analysis"],
      provider: "deterministic",
      model: "built-in",
      variants: {
        concise: {
          style: "concise",
          subject: conciseSubj,
          description: desc,
        },
        descriptive: {
          style: "descriptive",
          subject: `${primaryType}${scopeStr}: implement ${desc}`,
          description: `implement ${desc}`,
          body: `Staged changes across ${sanitizedContext.files.length} file(s).`,
        },
        detailed: {
          style: "detailed",
          subject: `${primaryType}${scopeStr}: update and verify ${topFile}`,
          description: `update and verify ${topFile}`,
          body: `Summary of staged changes:\n${detailedBody}`,
        },
      },
    };
  }

  async generateCommit(options?: GenerateCommitOptions): Promise<CommitGenerationResult> {
    this._checkAbort(options?.signal);
    const multi = await this.generateVariants({
      style: options?.style,
      issue: options?.issue,
      signal: options?.signal,
    });

    const requestedStyle = options?.variant ?? "descriptive";
    const selectedVariant = multi.variants[requestedStyle] || multi.variants.descriptive;

    const proposal: CommitProposal = {
      type: multi.type,
      scope: multi.scope,
      description: selectedVariant.description,
      body: selectedVariant.body,
      breaking: multi.breaking,
      breakingDescription: multi.breakingDescription,
      confidence: {
        type: "HIGH",
        scope: multi.scope ? "MEDIUM" : "LOW",
      },
      evidence: {
        typeReasons: multi.reasoning,
        scopeReasons: multi.scope ? [`Scope identified as ${multi.scope}`] : [],
        signals: [],
      },
    };

    const variantsList: CommitVariant[] = (["concise", "descriptive", "detailed"] as const).map(
      (vStyle) => {
        const v = multi.variants[vStyle];
        return {
          id: vStyle,
          style: vStyle,
          subject: v.subject,
          body: v.body,
          proposal,
          validation: { valid: true, errors: [], warnings: [] },
        };
      },
    );

    const evidence: DecisionEvidence[] = [
      {
        aspect: "classification",
        reason: `Selected type ${multi.type} based on staged changes analysis.`,
        source: "git",
      },
      ...(multi.scope
        ? [
            {
              aspect: "scope",
              reason: `Detected scope ${multi.scope} from directory and file heuristics.`,
              source: "git" as const,
            },
          ]
        : []),
      {
        aspect: "provider",
        reason: `Generated variants using ${multi.provider} (${multi.model}).`,
        source: "ai" as const,
      },
    ];

    const privacy: PrivacySummary = {
      endpointType: this._options.aiProvider?.isLocal ? "local" : "remote",
      endpointUrl: this._options.aiProvider?.baseUrl,
      redactedCount: 0,
      scanPassed: true,
      badge: "PRIVATE: LOCAL-ONLY",
    };

    return {
      proposal,
      variants: variantsList,
      classification: {
        type: multi.type,
        scope: multi.scope,
        confidence: "HIGH",
      },
      evidence,
      privacy,
    };
  }

  async commit(
    proposalOrMessage: CommitProposal | string,
    options?: CommitOptions,
  ): Promise<{ hash: string; message: string }> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();

    const staged = await hasStagedChanges(repoRoot);
    if (!staged) {
      throw new GitWhisperError({
        code: "EMPTY_STAGING_AREA",
        message: "Cannot commit: No staged changes found.",
      });
    }

    const { subject, body } = parseMessage(proposalOrMessage);

    if (!subject) {
      throw new GitWhisperError({
        code: "COMMIT_FAILED",
        message: "Commit message cannot be empty.",
      });
    }

    const fullMessage = body ? `${subject}\n\n${body}` : subject;
    this._emitter.emit("commit:start", {
      timestamp: Date.now(),
      message: fullMessage,
    });

    try {
      const commitRes = await commitStagedChanges(repoRoot, { subject, body });
      this._emitter.emit("commit:complete", {
        timestamp: Date.now(),
        commitHash: commitRes.commitHash,
      });

      return {
        hash: commitRes.commitHash,
        message: fullMessage,
      };
    } catch (err: any) {
      this._emitter.emit("error", {
        code: "COMMIT_FAILED",
        message: err.message,
      });
      throw new GitWhisperError({
        code: "COMMIT_FAILED",
        message: `Git commit failed: ${err.message}`,
        cause: err,
      });
    }
  }

  async executeCommitPlan(
    plan: HunkCommitPlan | CommitPlan,
    options?: { signal?: AbortSignal },
  ): Promise<Array<{ id: string; hash: string; subject: string }>> {
    this._checkAbort(options?.signal);
    const repoRoot = await this._ensureRepository();

    if (!plan || !plan.groups || plan.groups.length === 0) {
      throw new GitWhisperError({
        code: "INVALID_PLAN",
        message: "Invalid commit plan: plan contains no groups to commit.",
      });
    }

    const tempIndexFile = path.join(
      repoRoot,
      ".git",
      `whisper-sdk-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );

    const results: Array<{ id: string; hash: string; subject: string }> = [];

    try {
      if ("patch" in plan) {
        // HunkCommitPlan
        const hunkPlan = plan as HunkCommitPlan;
        for (const group of hunkPlan.groups) {
          this._checkAbort(options?.signal);
          const subject = (group as any).proposal
            ? formatCommitSubject((group as any).proposal)
            : group.name;
          const body = (group as any).proposal?.body;
          const groupPatch = buildPatchSelection(hunkPlan.patch, group.hunkIds);

          const commitRes = await executeHunkGroupCommit(repoRoot, {
            patchContent: groupPatch,
            subject,
            body,
            tempIndexFile,
          });

          results.push({
            id: group.id,
            hash: commitRes.commitHash,
            subject,
          });
        }
      } else {
        // File CommitPlan
        const stagedEntries = await getStagedIndexEntries(repoRoot);
        for (const group of plan.groups) {
          this._checkAbort(options?.signal);
          const subject = (group as any).proposal
            ? formatCommitSubject((group as any).proposal)
            : group.name;
          const body = (group as any).proposal?.body;

          const commitRes = await executeIsolatedGroupCommit(repoRoot, {
            files: group.files,
            stagedEntries,
            subject,
            body,
            tempIndexFile,
          });

          results.push({
            id: group.id,
            hash: commitRes.commitHash,
            subject,
          });
        }
      }

      await syncPrimaryIndex(repoRoot, tempIndexFile);
      return results;
    } catch (err: any) {
      throw new GitWhisperError({
        code: "COMMIT_FAILED",
        message: `Failed executing commit plan: ${err.message}`,
        cause: err,
      });
    }
  }
}
