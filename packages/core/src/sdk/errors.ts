export type GitWhisperErrorCode =
  | "NOT_A_GIT_REPOSITORY"
  | "NOT_GIT_REPOSITORY"
  | "EMPTY_STAGING_AREA"
  | "NO_STAGED_CHANGES"
  | "OPERATION_ABORTED"
  | "PRIVACY_VIOLATION"
  | "POLICY_VIOLATION"
  | "INVALID_PLAN"
  | "GIT_EXECUTION_FAILED"
  | "GIT_COMMIT_FAILED"
  | "PROVIDER_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "CONFIG_ERROR"
  | "COMMIT_FAILED"
  | "MERGE_CONFLICT"
  | "MODEL_UNAVAILABLE"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "INVALID_AI_RESPONSE"
  | "VALIDATION_FAILED"
  | "STALE_PLAN"
  | "HOOK_REJECTED"
  | "USER_CANCELLED";

export interface GitWhisperErrorOptions {
  code: GitWhisperErrorCode;
  message: string;
  recoverable?: boolean;
  actionableGuidance?: string;
  details?: unknown;
  cause?: unknown;
}

export class GitWhisperError extends Error {
  readonly code: GitWhisperErrorCode;
  readonly recoverable: boolean;
  readonly actionableGuidance?: string;
  readonly details?: unknown;

  constructor(
    optionsOrCode: GitWhisperErrorOptions | GitWhisperErrorCode,
    message?: string,
    actionableGuidance?: string,
    details?: unknown,
  ) {
    if (typeof optionsOrCode === "object") {
      super(optionsOrCode.message, { cause: optionsOrCode.cause });
      this.code = optionsOrCode.code;
      this.recoverable = optionsOrCode.recoverable ?? true;
      this.actionableGuidance = optionsOrCode.actionableGuidance;
      this.details = optionsOrCode.details;
    } else {
      super(message ?? optionsOrCode);
      this.code = optionsOrCode;
      this.recoverable = true;
      this.actionableGuidance = actionableGuidance;
      this.details = details;
    }
    this.name = "GitWhisperError";
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      actionableGuidance: this.actionableGuidance,
      details: this.details,
    };
  }
}
