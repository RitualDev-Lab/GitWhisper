export type ConventionalCommitType =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert";

export const DEFAULT_CONVENTIONAL_TYPES: readonly ConventionalCommitType[] = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface TypeCandidate {
  type: string;
  score: number;
  reasons: string[];
  confidence: ConfidenceLevel;
}

export interface ScopeCandidate {
  scope: string;
  score: number;
  reasons: string[];
  confidence: ConfidenceLevel;
}

export interface ChangeSignal {
  kind: string;
  source: "git" | "path" | "metadata" | "patch";
  evidence: string;
  weight: number;
}

export interface FileCategorySummary {
  total: number;
  test: number;
  documentation: number;
  dependency: number;
  configuration: number;
  source: number;
  binary: number;
  unknown: number;
}

export interface PackageChange {
  path: string;
  name?: string;
  dependenciesChanged: string[];
}

export interface ChangeIntelligence {
  fileCategories: FileCategorySummary;
  affectedDirectories: string[];
  packageChanges: PackageChange[];
  configChanges: string[];
  testChanges: string[];
  documentationChanges: string[];
  sourceChanges: string[];
  ciChanges: string[];
  buildChanges: string[];
  probableScopes: ScopeCandidate[];
  probableTypes: TypeCandidate[];
  signals: ChangeSignal[];
}

export interface CommitEvidence {
  typeReasons: string[];
  scopeReasons: string[];
  signals: ChangeSignal[];
}

export interface CommitProposal {
  type: string;
  scope?: string;
  description: string;
  body?: string;
  breaking: boolean;
  breakingDescription?: string;
  confidence: {
    type: ConfidenceLevel;
    scope: ConfidenceLevel;
  };
  evidence: CommitEvidence;
}

export interface ValidationIssue {
  code: string;
  message: string;
  field?: "type" | "scope" | "description" | "subject" | "body" | "breaking";
}

export interface CommitValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  formattedSubject?: string;
}

export interface ValidationRules {
  allowedTypes?: string[];
  allowedScopes?: string[];
  requireScope?: boolean;
  strictScopes?: boolean;
  maxSubjectLength?: number;
  allowVagueDescriptions?: boolean;
}
