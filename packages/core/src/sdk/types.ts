import type {
  CommitPlan,
  CommitProposal,
  CommitVariant,
  ConfidenceLevel,
  HunkCommitPlan,
  RepositoryCommitStyle,
} from "../index.js";
import type { GitPatch } from "../patch/types.js";
import type { CommitQualityCheckOptions, CommitQualityResult } from "../quality/types.js";
import type { ChangeContext } from "../types.js";
import type { BranchContext } from "../workitems/types.js";

export interface SDKCommitVariantContent {
  style: "concise" | "descriptive" | "detailed";
  subject: string;
  description: string;
  body?: string;
}

export interface SDKMultiVariantResult {
  type: string;
  scope?: string;
  breaking: boolean;
  breakingDescription?: string;
  variants: Record<"concise" | "descriptive" | "detailed", SDKCommitVariantContent>;
  reasoning: string[];
  provider: string;
  model: string;
  rawResponse?: string;
}

export interface DecisionEvidence {
  aspect: string;
  reason: string;
  source: "git" | "policy" | "history" | "config" | "ai";
}

export interface PrivacySummary {
  endpointType: "local" | "remote";
  endpointUrl?: string;
  redactedCount: number;
  scanPassed: boolean;
  badge: string;
}

export interface CommitGenerationResult {
  proposal: CommitProposal;
  variants: CommitVariant[];
  classification: {
    type?: string;
    scope?: string;
    confidence: ConfidenceLevel;
  };
  evidence: DecisionEvidence[];
  privacy: PrivacySummary;
}

export interface RepositoryStatus {
  root: string;
  name: string;
  branch: string;
  head: string;
  isInitial: boolean;
  hasStagedChanges: boolean;
  stagedFilesCount: number;
}

export interface GitWhisperOptions {
  repository: string;
  config?: any;
  aiProvider?: any;
  signal?: AbortSignal;
}

export interface GenerateCommitOptions {
  variant?: "concise" | "descriptive" | "detailed";
  style?: "auto" | "conventional" | "simple";
  allowedTypes?: string[];
  scopes?: string[];
  issue?: string;
  signal?: AbortSignal;
}

export interface GenerateVariantsOptions {
  style?: "auto" | "conventional" | "simple";
  issue?: string;
  signal?: AbortSignal;
}

export interface CreatePlanOptions {
  level?: "file" | "hunk" | "auto";
  signal?: AbortSignal;
}

export interface CheckCommitOptions extends Partial<CommitQualityCheckOptions> {
  strict?: boolean;
  ai?: boolean;
  signal?: AbortSignal;
}

export interface CommitOptions {
  signal?: AbortSignal;
}

export interface GitWhisperEvents {
  "analysis:start": { timestamp: number; repository: string };
  "analysis:complete": { timestamp: number; filesCount: number; durationMs: number };
  "provider:start": { timestamp: number; provider: string; model?: string };
  "provider:complete": { timestamp: number; provider: string; durationMs: number };
  "commit:start": { timestamp: number; message: string };
  "commit:complete": { timestamp: number; commitHash: string };
  error: { code: string; message: string };
}

export interface GitWhisperClient {
  readonly repository: string;

  analyzeStagedChanges(options?: { signal?: AbortSignal }): Promise<ChangeContext>;

  generateCommit(options?: GenerateCommitOptions): Promise<CommitGenerationResult>;

  generateVariants(options?: GenerateVariantsOptions): Promise<SDKMultiVariantResult>;

  createCommitPlan(options?: CreatePlanOptions): Promise<HunkCommitPlan | CommitPlan>;

  createSplitPlan(options?: CreatePlanOptions): Promise<HunkCommitPlan | CommitPlan>;

  analyzeHunks(options?: { signal?: AbortSignal }): Promise<GitPatch>;

  checkCommit(messageOrTarget: string, options?: CheckCommitOptions): Promise<CommitQualityResult>;

  analyzeRepositoryStyle(options?: {
    signal?: AbortSignal;
    limit?: number;
  }): Promise<RepositoryCommitStyle | undefined>;

  detectWorkItem(options?: { signal?: AbortSignal; key?: string }): Promise<BranchContext>;

  getRepositoryStatus(options?: { signal?: AbortSignal }): Promise<RepositoryStatus>;

  getCommitTimeline(
    options?: import("../timeline/types.js").TimelineOptions,
  ): Promise<import("../timeline/types.js").CommitTimeline>;

  commit(
    proposalOrMessage: CommitProposal | string,
    options?: CommitOptions,
  ): Promise<{ hash: string; message: string }>;

  executeCommitPlan(
    plan: HunkCommitPlan | CommitPlan,
    options?: { signal?: AbortSignal },
  ): Promise<any>;

  on<E extends keyof GitWhisperEvents>(
    event: E,
    listener: (payload: GitWhisperEvents[E]) => void,
  ): this;

  off<E extends keyof GitWhisperEvents>(
    event: E,
    listener: (payload: GitWhisperEvents[E]) => void,
  ): this;
}
