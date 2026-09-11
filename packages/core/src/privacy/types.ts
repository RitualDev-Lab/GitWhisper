import type { ChangeContext } from "../types.js";

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

export interface PrivacyConfigOptions {
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

export type SecretCategory =
  | "api-key"
  | "access-token"
  | "jwt"
  | "password"
  | "private-key"
  | "cloud-credential"
  | "authorization-header"
  | "connection-string"
  | "oauth-secret"
  | "webhook-secret"
  | "environment-secret"
  | "certificate-secret"
  | "generic-secret";

export type LineType = "added" | "deleted" | "context" | "message";

export interface SecretFinding {
  id: string;
  category: SecretCategory;
  detector: string;
  confidence: SecretConfidence;
  filePath: string;
  lineNumber: number;
  lineType: LineType;
  matchedText: string;
  maskedPreview: string;
  startColumn: number;
  endColumn: number;
  placeholder: string;
  fingerprint: string;
  description?: string;
}

export interface SensitiveScanInput {
  patch?: string;
  files?: Array<{ path: string; patch?: string; status?: string }>;
  text?: string;
  filePath?: string;
}

export interface SecretDetector {
  name: string;
  scan(input: SensitiveScanInput): Promise<SecretFinding[]> | SecretFinding[];
}

export type ProviderLocation = "local" | "remote" | "unknown";

export interface RedactionRecord {
  category: SecretCategory;
  filePath: string;
  lineNumber: number;
  placeholder: string;
  maskedPreview: string;
}

export type PrivacyDecisionState = "safe" | "sanitized" | "blocked";

export interface PrivacyDecision {
  state: PrivacyDecisionState;
  actionTaken: "none" | "redacted" | "blocked" | "warned";
  findingsCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  reasons: string[];
}

export interface ProviderSafeContext {
  readonly changeContext: ChangeContext;
  readonly providerLocation: ProviderLocation;
  readonly decision: PrivacyDecision;
  readonly findings: SecretFinding[];
  readonly redactions: RedactionRecord[];
  readonly isSanitized: boolean;
  readonly transmissionReport: ProviderTransmissionReport;
}

export interface ProviderTransmissionReport {
  timestamp: string;
  providerLocation: ProviderLocation;
  filesCount: number;
  bytesTotal: number;
  redactionsCount: number;
  branchStripped: boolean;
  repoNameStripped: boolean;
  examplesStripped: boolean;
}

export interface ScanResult {
  findings: SecretFinding[];
  scannedBytes: number;
  isFailClosed?: boolean;
  error?: string;
}
