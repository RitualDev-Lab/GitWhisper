import type { GitFileStatus } from "@gitwhisper/git";
import type { FileCategory } from "../types.js";
import type { CommitProposal } from "../intelligence/types.js";

export type RelationshipType =
  | "source-test"
  | "manifest-lockfile"
  | "rename"
  | "directory-prefix"
  | "import-dependency"
  | "doc-source";

export interface ChangeRelationship {
  source: string;
  target: string;
  type: RelationshipType;
  confidence: number;
  reason: string;
}

export interface ChangeNode {
  path: string;
  status: GitFileStatus;
  category: FileCategory;
  directory: string;
}

import type { GroupWorkItemAssociation } from "../workitems/types.js";

export interface CommitGroup {
  id: string;
  name: string;
  concern: string;
  files: string[];
  relationships: ChangeRelationship[];
  confidence: number;
  proposal?: CommitProposal;
  workItems?: GroupWorkItemAssociation[];
}

export interface CommitPlan {
  id: string;
  timestamp: string;
  indexFingerprint: string;
  totalFiles: number;
  isSingleConcern: boolean;
  cohesionScore: number;
  groups: CommitGroup[];
  relationships: ChangeRelationship[];
  warnings: string[];
}

export interface PlanOptions {
  minimumConfidence?: number | "low" | "medium" | "high";
  maxFilesForSemanticAnalysis?: number;
  suggestSplit?: boolean;
}
