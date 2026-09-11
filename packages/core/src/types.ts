import type { GitFileChange, GitRepository, GitStats } from "@gitwhisper/git";
import type { ChangeIntelligence } from "./intelligence/types.js";

export type FileCategory =
  | "test"
  | "documentation"
  | "dependency"
  | "configuration"
  | "source"
  | "binary"
  | "unknown";

export interface ClassifiedFileChange extends GitFileChange {
  category: FileCategory;
}

export interface DiffMetadata {
  originalBytes: number;
  includedBytes: number;
  truncated: boolean;
  warning?: string;
}

export interface ChangeCharacteristics {
  hasTests: boolean;
  hasDocumentation: boolean;
  hasConfiguration: boolean;
  hasDependencies: boolean;
  hasBinaryChanges: boolean;
}

export interface ChangeContext {
  repository: {
    root: string;
    name: string;
    branch: string | null;
    head: string | null;
    isInitial: boolean;
  };
  files: ClassifiedFileChange[];
  stats: GitStats;
  patch: string;
  diffMetadata: DiffMetadata;
  characteristics: ChangeCharacteristics;
  intelligence: ChangeIntelligence;
}

export interface DiffGuardOptions {
  maxSafeBytes?: number;
  hardLimitBytes?: number;
}
