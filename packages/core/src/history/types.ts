import type { ConfidenceLevel } from "../intelligence/types.js";

export type SubjectCase = "lowercase" | "sentence" | "title" | "uppercase" | "mixed" | "unknown";

export type ConventionStyle = "conventional" | "simple" | "mixed" | "unknown";

export interface CommitTypeFrequency {
  type: string;
  count: number;
  frequency: number;
}

export interface ScopeFrequency {
  scope: string;
  count: number;
  frequency: number;
}

export interface HistoricalScopeMapping {
  pathPrefix: string;
  scope: string;
  observations: number;
  confidence: ConfidenceLevel;
}

export interface CommitStyleExample {
  subject: string;
  body?: string;
  reason: "common-pattern" | "type-example" | "scope-example";
}

export interface RepositoryCommitStyle {
  sampleSize: number;
  totalAnalyzed: number;
  ignoredMerges: number;
  isShallow: boolean;
  convention: {
    style: ConventionStyle;
    confidence: ConfidenceLevel;
    conventionalRatio: number;
  };
  types: CommitTypeFrequency[];
  scopes: ScopeFrequency[];
  pathScopeMappings: HistoricalScopeMapping[];
  formatting: {
    subjectCase: SubjectCase;
    averageSubjectLength: number;
    medianSubjectLength: number;
    maxObservedSubjectLength: number;
    trailingPeriodFrequency: number;
    bodyUsageFrequency: number;
    blankLineBeforeBodyFrequency: number;
  };
  features: {
    usesScopes: boolean;
    usesBreakingMarker: boolean;
    usesEmoji: boolean;
    usesIssueReferences: boolean;
    usesTicketPrefixes: boolean;
  };
  examples: CommitStyleExample[];
}

export type DecisionSource = "user" | "config" | "git" | "history" | "ai" | "default";

export interface DecisionProvenance {
  field: string;
  decision: string;
  source: DecisionSource;
  evidence: string[];
}
