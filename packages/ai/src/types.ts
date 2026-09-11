import type { GitFileChange } from "@gitwhisper/git";

export interface CommitGenerationStyleContext {
  style: "conventional" | "simple";
  subjectCase?: string;
  preferBody?: boolean;
  subjectTargetLength?: number;
  commonScopes?: string[];
  representativeExamples?: string[];
}

export interface WorkItemGenerationContext {
  reference?: string;
  title?: string;
  relevantSummary?: string;
  referenceStyle?: string;
}

export interface CommitGenerationRequest {
  repository: {
    name: string;
    branch: string | null;
  };
  files: GitFileChange[];
  stats: {
    additions: number;
    deletions: number;
  };
  patch: string;
  characteristics?: {
    hasTests: boolean;
    hasDocumentation: boolean;
    hasConfiguration: boolean;
    hasDependencies: boolean;
    hasBinaryChanges: boolean;
  };
  allowedTypes?: string[];
  suggestedScopes?: string[];
  forcedType?: string;
  forcedScope?: string;
  styleContext?: CommitGenerationStyleContext;
  workItemContext?: WorkItemGenerationContext;
}

export interface CommitGenerationResult {
  type: string;
  scope?: string;
  description: string;
  subject: string;
  body?: string;
  breaking: boolean;
  breakingDescription?: string;
  reasoning: string[];
  provider: string;
  model: string;
  rawResponse?: string;
}

export type CommitVariantStyle = "concise" | "descriptive" | "detailed";

export interface CommitVariantContent {
  style: CommitVariantStyle;
  subject: string;
  description: string;
  body?: string;
}

export interface MultiVariantGenerationResult {
  type: string;
  scope?: string;
  breaking: boolean;
  breakingDescription?: string;
  variants: Record<CommitVariantStyle, CommitVariantContent>;
  reasoning: string[];
  provider: string;
  model: string;
  rawResponse?: string;
}

export interface ProviderValidation {
  valid: boolean;
  error?: string;
  availableModels?: string[];
}

export interface AIProvider {
  readonly id: string;
  readonly isLocal: boolean;
  readonly model: string;
  readonly baseUrl: string;

  validateConfiguration(): Promise<ProviderValidation>;
  generateCommitMessage(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<CommitGenerationResult>;
  generateCommitVariants?(
    request: CommitGenerationRequest,
    signal?: AbortSignal,
  ): Promise<MultiVariantGenerationResult>;
}

export class AIProviderError extends Error {
  readonly providerId: string;
  readonly statusCode?: number;
  readonly isRetryable: boolean;

  constructor(message: string, providerId: string, statusCode?: number, isRetryable = false) {
    super(message);
    this.name = "AIProviderError";
    this.providerId = providerId;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export class AIConnectionError extends AIProviderError {
  constructor(providerId: string, endpoint: string, originalError?: Error) {
    super(
      `Could not connect to ${providerId} at ${endpoint}.\nEnsure the service is running and accessible.\n${originalError ? `Details: ${originalError.message}` : ""}`,
      providerId,
      undefined,
      true,
    );
    this.name = "AIConnectionError";
  }
}

export class AIAuthenticationError extends AIProviderError {
  constructor(providerId: string) {
    super(
      `Authentication failed for ${providerId}. Check your API key or authorization settings.`,
      providerId,
      401,
      false,
    );
    this.name = "AIAuthenticationError";
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(providerId: string) {
    super(
      `Rate limit exceeded on ${providerId}. Please wait a moment before retrying.`,
      providerId,
      429,
      true,
    );
    this.name = "AIRateLimitError";
  }
}

export class AIModelNotFoundError extends AIProviderError {
  constructor(providerId: string, model: string, available?: string[]) {
    const list = available?.length ? `\nAvailable models: ${available.join(", ")}` : "";
    super(
      `Model "${model}" was not found on ${providerId}.${list}\nChoose an available model using \`gitwhisper config\` or \`gitwhisper --model <model>\`.`,
      providerId,
      404,
      false,
    );
    this.name = "AIModelNotFoundError";
  }
}

export class AIOutputValidationError extends AIProviderError {
  readonly rawOutput: string;

  constructor(message: string, providerId: string, rawOutput: string) {
    super(
      `Provider ${providerId} returned an invalid commit response: ${message}`,
      providerId,
      undefined,
      false,
    );
    this.name = "AIOutputValidationError";
    this.rawOutput = rawOutput;
  }
}
