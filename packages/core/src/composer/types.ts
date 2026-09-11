import type { ChangeContext } from "../types.js";
import type { CommitProposal, CommitValidationResult } from "../intelligence/types.js";
import type { DecisionProvenance } from "../history/types.js";
import type { CommitPlan } from "../planning/types.js";
import type { HunkCommitPlan } from "../planning/hunk-planner.js";
import type { GitWhisperError } from "../sdk/errors.js";

export type ComposerState =
  | "analyzing"
  | "reviewing"
  | "editing"
  | "selecting-type"
  | "selecting-scope"
  | "viewing-details"
  | "viewing-patch"
  | "regenerating"
  | "committing"
  | "completed"
  | "cancelled"
  | "error";

export type CommitVariantStyle = "concise" | "descriptive" | "detailed";

export interface CommitVariant {
  id: string;
  style: CommitVariantStyle;
  subject: string;
  body?: string;
  proposal: CommitProposal;
  validation: CommitValidationResult;
}

export { type GitWhisperErrorCode, GitWhisperError } from "../sdk/errors.js";

export interface ComposerOverrides {
  type?: string;
  scope?: string;
  breaking?: boolean;
  manualSubject?: string;
  manualBody?: string;
}

export interface RepositorySummary {
  root: string;
  name: string;
  branch: string | null;
  isDetached: boolean;
  headHash?: string;
  hasCommits: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
}

export interface ProviderSummary {
  id: string;
  model: string;
  isLocal: boolean;
  privacyLabel: "Local" | "Remote";
}

export interface ComposerTiming {
  gitAnalysisMs: number;
  intelligenceMs: number;
  providerMs?: number;
  totalMs: number;
}

export interface CommitComposerSession {
  id: string;
  repository: RepositorySummary;
  changeContext: ChangeContext;
  plan?: CommitPlan | HunkCommitPlan;
  activeGroup?: string;
  variants: CommitVariant[];
  selectedVariantId: string;
  overrides: ComposerOverrides;
  evidence: DecisionProvenance[];
  timing: ComposerTiming;
  provider: ProviderSummary;
  state: ComposerState;
  error?: GitWhisperError;
}
