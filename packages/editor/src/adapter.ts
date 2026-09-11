import {
  type ChangeContext,
  type CheckCommitOptions,
  type CommitGenerationResult,
  type CommitOptions,
  type CommitPlan,
  type CommitProposal,
  type CreatePlanOptions,
  createGitWhisper,
  type GenerateCommitOptions,
  type GenerateVariantsOptions,
  type GitWhisperClient,
  GitWhisperError,
  type HunkCommitPlan,
  type SDKMultiVariantResult,
} from "@gitwhisper/core";
import type {
  CommitEvidenceView,
  ConcernDetectionResult,
  EditorCommitExecutionOptions,
  IDEActionResult,
  IDEContext,
} from "./types.js";

function errorToResult<T>(err: any): IDEActionResult<T> {
  if (err instanceof GitWhisperError) {
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
  }
  return {
    success: false,
    error: {
      code: "UNKNOWN_ERROR",
      message: err.message || "An unexpected error occurred in GitWhisper.",
      details: err,
    },
  };
}

export class MyIDEAdapter {
  readonly context: IDEContext;
  private _client?: GitWhisperClient;

  constructor(context: IDEContext, client?: GitWhisperClient) {
    if (!context?.repositoryRoot) {
      throw new Error("MyIDEAdapter requires a valid repositoryRoot in IDEContext.");
    }
    this.context = context;
    this._client = client;
  }

  private async _getClient(): Promise<GitWhisperClient> {
    if (!this._client) {
      this._client = await createGitWhisper({
        repository: this.context.repositoryRoot,
      });
    }
    return this._client;
  }

  /**
   * Generates commit message proposal with variants.
   * Strictly analytical; never mutates Git state.
   */
  async generateCommitMessage(
    options?: GenerateCommitOptions,
  ): Promise<IDEActionResult<CommitGenerationResult>> {
    try {
      const client = await this._getClient();
      const result = await client.generateCommit(options);
      return { success: true, data: result };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Generates multi-variant commit messages (concise, descriptive, detailed).
   * Strictly analytical; never mutates Git state.
   */
  async generateVariants(
    options?: GenerateVariantsOptions,
  ): Promise<IDEActionResult<SDKMultiVariantResult>> {
    try {
      const client = await this._getClient();
      const result = await client.generateVariants(options);
      return { success: true, data: result };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Returns a transparent decision evidence summary explaining how GitWhisper
   * reached its type/scope/message decisions.
   */
  async explainCommit(): Promise<IDEActionResult<CommitEvidenceView>> {
    try {
      const client = await this._getClient();
      const [context, genResult] = await Promise.all([
        client.analyzeStagedChanges(),
        client.generateCommit(),
      ]);

      const reasons: string[] = [];
      for (const e of genResult.evidence) {
        reasons.push(`[${e.aspect.toUpperCase()}] ${e.reason}`);
      }

      return {
        success: true,
        data: {
          classification: {
            type: genResult.classification.type,
            scope: genResult.classification.scope,
            confidence: genResult.classification.confidence,
          },
          filesCount: context.files.length,
          stats: {
            additions: context.stats.additions,
            deletions: context.stats.deletions,
          },
          reasons,
          privacyBadge: genResult.privacy.badge,
          provider: genResult.proposal.evidence?.typeReasons?.[0] || "deterministic",
        },
      };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Evaluates proposed commit message against quality policy and staged changes.
   */
  async checkMessage(message: string, options?: CheckCommitOptions): Promise<IDEActionResult<any>> {
    try {
      const client = await this._getClient();
      const result = await client.checkCommit(message, options);
      return { success: true, data: result };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Evaluates whether staged changes encompass multiple distinct concerns.
   */
  async detectMultipleConcerns(): Promise<IDEActionResult<ConcernDetectionResult>> {
    try {
      const client = await this._getClient();
      const plan = await client.createCommitPlan({ level: "auto" });

      const concerns = plan.groups.map((g: any) => ({
        id: g.id,
        name: g.name || g.concern || "Group",
        files: g.files || (g.fileChanges ? g.fileChanges.map((fc: any) => fc.file) : []),
      }));

      const multiple = concerns.length > 1;

      return {
        success: true,
        data: {
          multipleConcernsDetected: multiple,
          concernsCount: concerns.length,
          concerns,
          recommendation: multiple ? "split_commit" : "single_commit",
        },
      };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Creates an atomic commit splitting plan.
   */
  async createCommitPlan(
    options?: CreatePlanOptions,
  ): Promise<IDEActionResult<HunkCommitPlan | CommitPlan>> {
    try {
      const client = await this._getClient();
      const plan = await client.createCommitPlan(options);
      return { success: true, data: plan };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Previews diff/patch for staged changes or a specific plan group.
   */
  async previewCommitPatch(groupId?: string): Promise<IDEActionResult<string>> {
    try {
      const client = await this._getClient();
      const context = await client.analyzeStagedChanges();

      if (!groupId) {
        return { success: true, data: context.patch };
      }

      const plan = await client.createCommitPlan();
      const group = plan.groups.find((g) => g.id === groupId);
      if (!group) {
        return {
          success: false,
          error: {
            code: "GROUP_NOT_FOUND",
            message: `Group '${groupId}' not found in commit plan.`,
          },
        };
      }

      return { success: true, data: context.patch };
    } catch (err) {
      return errorToResult(err);
    }
  }

  /**
   * Executes an approved commit or commit plan.
   *
   * CRITICAL SAFETY INVARIANT:
   * Requires explicit confirmation ({ confirmed: true }) from developer.
   * Will never commit silently without developer confirmation.
   */
  async executeApprovedCommit(
    approvedCommit: string | CommitProposal | HunkCommitPlan | CommitPlan,
    options: EditorCommitExecutionOptions,
  ): Promise<IDEActionResult<any>> {
    if (!options?.confirmed) {
      return {
        success: false,
        error: {
          code: "CONFIRMATION_REQUIRED",
          message:
            "Execution aborted: Explicit developer confirmation is strictly required before committing changes.",
        },
      };
    }

    try {
      const client = await this._getClient();
      if (
        typeof approvedCommit === "object" &&
        "groups" in approvedCommit &&
        Array.isArray((approvedCommit as any).groups)
      ) {
        const result = await client.executeCommitPlan(
          approvedCommit as HunkCommitPlan | CommitPlan,
          { signal: options.signal },
        );
        return { success: true, data: result };
      }

      const result = await client.commit(approvedCommit as string | CommitProposal, {
        signal: options.signal,
      });
      return { success: true, data: result };
    } catch (err) {
      return errorToResult(err);
    }
  }
}
