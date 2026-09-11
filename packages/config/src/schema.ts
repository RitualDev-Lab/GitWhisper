export type ProviderType = "ollama" | "openai-compatible";
export type CommitStyle = "auto" | "conventional" | "simple";
export type CommitBodyPolicy = "auto" | "always" | "never";

export interface OllamaConfig {
  baseUrl: string;
}

export interface OpenAICompatConfig {
  baseUrl: string;
  apiKey?: string;
}

export type HookMode = "off" | "warn" | "strict";

export interface HooksConfig {
  commitMsg?: HookMode;
}

export interface CommitPolicy {
  style: CommitStyle;
  allowedTypes: string[];
  scopes?: string[];
  requiredScopes?: string[];
  strictScopes?: boolean;
  maxSubjectLength: number;
  requireScope: boolean;
  requireWorkItem?: boolean;
  workItemMode: "none" | "reference" | "close";
  allowVagueDescriptions?: boolean;
}

export interface CommitConfig {
  style?: CommitStyle;
  maxSubjectLength?: number;
  requireScope?: boolean;
  body?: CommitBodyPolicy;
  allowedTypes?: string[];
  scopes?: string[];
  requiredScopes?: string[];
  strictScopes?: boolean;
  allowVagueDescriptions?: boolean;
  requireWorkItem?: boolean;
}

export interface HistoryConfig {
  enabled?: boolean;
  limit?: number;
  includeMergeCommits?: boolean;
  sendExamplesToAI?: boolean;
  minimumSampleSize?: number;
  learnScopes?: boolean;
  learnFormatting?: boolean;
}

export interface PlanningConfig {
  enabled?: boolean;
  suggestSplit?: boolean;
  minimumConfidence?: "low" | "medium" | "high";
  maxFilesForSemanticAnalysis?: number;
  allowFileLevelSplitting?: boolean;
  allowHunkLevelSplitting?: boolean;
}

export interface ComposerConfig {
  defaultVariant?: "concise" | "descriptive" | "detailed";
  showEvidence?: boolean;
  showProvider?: boolean;
  confirmBeforeCommit?: boolean;
  confirmBeforeMultiCommit?: boolean;
  color?: "auto" | "always" | "never";
  editor?: "inline" | "git";
}

export type SecretConfidence = "high" | "medium" | "low";
export type SecretAction = "block" | "redact" | "warn" | "ignore";

export interface PrivacyActionPolicy {
  highConfidence: "block" | "redact";
  mediumConfidence: "block" | "redact" | "warn";
  lowConfidence: "warn" | "ignore";
}

export interface CustomSecretPattern {
  name: string;
  pattern: string;
  category?: string;
  confidence?: SecretConfidence;
  action?: SecretAction;
}

export interface PrivacyIgnoreRule {
  path?: string;
  detector?: string;
  fingerprint?: string;
}

export interface PrivacyConfig {
  scanSecrets?: boolean;
  remote?: Partial<PrivacyActionPolicy>;
  local?: Partial<PrivacyActionPolicy>;
  sendBranchName?: boolean;
  sendRepositoryName?: boolean;
  sendCommitExamples?: boolean;
  customPatterns?: CustomSecretPattern[];
  ignore?: PrivacyIgnoreRule[];
  maxScanSizeBytes?: number;
}

export type WorkItemProviderId = "github" | "gitlab" | "jira" | "linear" | "generic";
export type ReferenceMode = "none" | "reference" | "close";
export type IssuePlacement = "footer" | "subject" | "body" | "auto";

export interface WorkItemProviderConfig {
  provider: WorkItemProviderId;
  baseUrl?: string;
  project?: string;
  token?: string;
}

export interface WorkItemsConfig {
  enabled?: boolean;
  autoDetectFromBranch?: boolean;
  autoFetch?: boolean;
  defaultReferenceMode?: ReferenceMode;
  referenceKeyword?: string;
  closingKeyword?: string;
  placement?: IssuePlacement;
  patterns?: string[];
  providers?: Record<string, WorkItemProviderConfig>;
  trustedHosts?: string[];
}

export interface GitWhisperConfig {
  provider: ProviderType;
  model: string;
  commit?: CommitConfig;
  history?: HistoryConfig;
  planning?: PlanningConfig;
  composer?: ComposerConfig;
  privacy?: PrivacyConfig;
  workItems?: WorkItemsConfig;
  hooks?: HooksConfig;
  providers: {
    ollama?: OllamaConfig;
    "openai-compatible"?: OpenAICompatConfig;
  };
}

export interface ConfigOverrides {
  provider?: ProviderType;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  commit?: CommitConfig;
  history?: HistoryConfig;
  planning?: PlanningConfig;
  composer?: ComposerConfig;
  privacy?: PrivacyConfig;
  workItems?: WorkItemsConfig;
  hooks?: HooksConfig;
}

export interface ResolvedConfig {
  provider: ProviderType;
  model: string;
  baseUrl: string;
  apiKey?: string;
  commit: Required<Omit<CommitConfig, "scopes" | "requiredScopes">> & {
    scopes?: string[];
    requiredScopes?: string[];
  };
  history: Required<HistoryConfig>;
  planning: Required<PlanningConfig>;
  composer: Required<ComposerConfig>;
  hooks: Required<HooksConfig>;
  privacy: {
    scanSecrets: boolean;
    remote: PrivacyActionPolicy;
    local: PrivacyActionPolicy;
    sendBranchName: boolean;
    sendRepositoryName: boolean;
    sendCommitExamples: boolean;
    customPatterns: CustomSecretPattern[];
    ignore: PrivacyIgnoreRule[];
    maxScanSizeBytes: number;
  };
  workItems: Required<Omit<WorkItemsConfig, "providers">> & {
    providers: Record<string, WorkItemProviderConfig>;
  };
  isConfigured: boolean;
  configFilePath: string;
}

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:7b";

export const DEFAULT_OPENAI_COMPAT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENAI_COMPAT_MODEL = "gpt-4o-mini";

export const DEFAULT_ALLOWED_TYPES = [
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
];

export const DEFAULT_HOOKS_CONFIG: Required<HooksConfig> = {
  commitMsg: "warn",
};

export const DEFAULT_COMMIT_CONFIG: Required<Omit<CommitConfig, "scopes" | "requiredScopes">> & {
  scopes?: string[];
  requiredScopes?: string[];
} = {
  style: "auto",
  maxSubjectLength: 72,
  requireScope: false,
  body: "auto",
  allowedTypes: DEFAULT_ALLOWED_TYPES,
  scopes: undefined,
  requiredScopes: undefined,
  strictScopes: false,
  allowVagueDescriptions: false,
  requireWorkItem: false,
};

export const DEFAULT_HISTORY_CONFIG: Required<HistoryConfig> = {
  enabled: true,
  limit: 50,
  includeMergeCommits: false,
  sendExamplesToAI: false,
  minimumSampleSize: 5,
  learnScopes: true,
  learnFormatting: true,
};

export const DEFAULT_PLANNING_CONFIG: Required<PlanningConfig> = {
  enabled: true,
  suggestSplit: true,
  minimumConfidence: "medium",
  maxFilesForSemanticAnalysis: 100,
  allowFileLevelSplitting: true,
  allowHunkLevelSplitting: false,
};

export const DEFAULT_COMPOSER_CONFIG: Required<ComposerConfig> = {
  defaultVariant: "descriptive",
  showEvidence: false,
  showProvider: true,
  confirmBeforeCommit: true,
  confirmBeforeMultiCommit: true,
  color: "auto",
  editor: "inline",
};

export const DEFAULT_PRIVACY_CONFIG: ResolvedConfig["privacy"] = {
  scanSecrets: true,
  remote: {
    highConfidence: "block",
    mediumConfidence: "redact",
    lowConfidence: "warn",
  },
  local: {
    highConfidence: "redact",
    mediumConfidence: "redact",
    lowConfidence: "warn",
  },
  sendBranchName: false,
  sendRepositoryName: false,
  sendCommitExamples: false,
  customPatterns: [],
  ignore: [],
  maxScanSizeBytes: 10 * 1024 * 1024, // 10MB
};

export const DEFAULT_WORK_ITEMS_CONFIG: ResolvedConfig["workItems"] = {
  enabled: true,
  autoDetectFromBranch: true,
  autoFetch: false,
  defaultReferenceMode: "reference",
  referenceKeyword: "Refs",
  closingKeyword: "Fixes",
  placement: "footer",
  patterns: [],
  providers: {},
  trustedHosts: [],
};
