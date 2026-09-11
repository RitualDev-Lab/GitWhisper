import type { ConfidenceLevel } from "../intelligence/types.js";

export type WorkItemProviderId = "github" | "gitlab" | "jira" | "linear" | "generic";
export type ReferenceMode = "none" | "reference" | "close";
export type IssuePlacement = "footer" | "subject" | "body" | "auto";

export type WorkItemReferenceSource = "branch" | "config" | "user" | "commit-history";

export interface WorkItemReference {
  raw: string;
  key: string;
  providerHint?: WorkItemProviderId;
  source: WorkItemReferenceSource;
  confidence: "high" | "medium" | "low";
}

export interface BranchContext {
  name?: string;
  detached: boolean;
  references: WorkItemReference[];
  normalizedDescription?: string;
  confidence: "high" | "medium" | "low";
}

export interface WorkItem {
  provider: WorkItemProviderId;
  key: string;
  title?: string;
  description?: string;
  state?: string;
  url?: string;
  labels?: string[];
  project?: string;
  fetchedAt?: string;
}

export interface WorkItemProviderValidation {
  valid: boolean;
  error?: string;
}

export interface WorkItemResolution {
  found: boolean;
  workItem?: WorkItem;
  error?: string;
}

export interface WorkItemProvider {
  readonly id: WorkItemProviderId;
  validateConfiguration(): Promise<WorkItemProviderValidation>;
  resolve(reference: WorkItemReference, signal?: AbortSignal): Promise<WorkItemResolution>;
}

export type IntentRelevance = "high" | "medium" | "low" | "unknown";

export interface IntentEvidence {
  signal: string;
  strength: "strong" | "moderate" | "weak";
  description: string;
}

export interface CommitIntentContext {
  branch?: BranchContext;
  workItem?: WorkItem;
  relevance: IntentRelevance;
  evidence: IntentEvidence[];
}

export interface IssueReferencePolicy {
  mode: ReferenceMode;
  referenceKeyword?: string;
  closingKeyword?: string;
  placement?: IssuePlacement;
}

export interface ExternalServiceUsage {
  service: string;
  purpose: "ai" | "work-item";
  location: "local" | "remote";
  host?: string;
}

export interface CachedWorkItem {
  workItem: WorkItem;
  fetchedAt: number;
  expiresAt: number;
}

export interface GroupWorkItemAssociation {
  reference: WorkItemReference;
  relevance: IntentRelevance;
  userApproved: boolean;
}
