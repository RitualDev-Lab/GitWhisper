import type { ChangeContext } from "../types.js";
import type { BranchContext } from "../workitems/types.js";

export type CommitStyle = "auto" | "conventional" | "simple";

export interface CommitPolicy {
  style: CommitStyle;
  allowedTypes: string[];
  scopes?: string[];
  requiredScopes?: string[];
  strictScopes?: boolean;
  maxSubjectLength: number;
  requireScope: boolean;
  requireWorkItem?: boolean;
  workItemMode?: "none" | "reference" | "close";
  allowVagueDescriptions?: boolean;
}

export type QualityRating = "excellent" | "good" | "needs-improvement" | "poor";

export type QualityIssueSeverity = "error" | "warning" | "suggestion";

export interface CommitQualityIssue {
  code: string;
  severity: QualityIssueSeverity;
  message: string;
  suggestion?: string;
  evidence?: string[];
}

export interface QualityCheckItem {
  name: string;
  passed: boolean;
  message?: string;
}

export interface ParsedCommitTrailer {
  token: string;
  value: string;
  raw: string;
}

export interface ParsedCommit {
  raw: string;
  subject: string;
  body?: string;
  type?: string;
  scope?: string;
  breaking: boolean;
  description: string;
  trailers: ParsedCommitTrailer[];
  isConventional: boolean;
}

export interface CommitQualityResult {
  rating: QualityRating;
  score: number;
  valid: boolean;
  issues: CommitQualityIssue[];
  checks: QualityCheckItem[];
  suggested?: {
    subject: string;
    body?: string;
  };
  suggestedMessage?: string;
  rawMessage: string;
  parsedCommit?: ParsedCommit;
}

export interface CommitQualityCheckOptions {
  message: string;
  policy: CommitPolicy;
  changeContext?: ChangeContext;
  branchContext?: BranchContext;
  strict?: boolean;
}
