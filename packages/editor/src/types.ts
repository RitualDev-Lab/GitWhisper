import type {
  CommitGenerationResult,
  CommitPlan,
  CommitQualityResult,
  HunkCommitPlan,
  SDKMultiVariantResult,
} from "@gitwhisper/core";

export interface IDEContext {
  repositoryRoot: string;
  activeFilePath?: string;
  selectedDiff?: string;
  editorName: string;
  workspaceFolders?: string[];
}

export interface IDEActionResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface CommitEvidenceView {
  classification: {
    type?: string;
    scope?: string;
    confidence: string;
  };
  filesCount: number;
  stats: {
    additions: number;
    deletions: number;
  };
  reasons: string[];
  privacyBadge: string;
  provider: string;
}

export interface ConcernDetectionResult {
  multipleConcernsDetected: boolean;
  concernsCount: number;
  concerns: Array<{
    id: string;
    name: string;
    files: string[];
  }>;
  recommendation: "single_commit" | "split_commit";
}

export interface EditorCommitExecutionOptions {
  confirmed: boolean;
  signal?: AbortSignal;
}
