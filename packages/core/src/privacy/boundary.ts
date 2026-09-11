import type { ChangeContext } from "../types.js";
import { classifyProviderLocation } from "./endpoint.js";
import { redactChangeContext } from "./redactor.js";
import { scanSensitiveContent } from "./scanner.js";
import type {
  PrivacyActionPolicy,
  PrivacyConfigOptions,
  PrivacyDecision,
  ProviderLocation,
  ProviderSafeContext,
  ProviderTransmissionReport,
  RedactionRecord,
  SecretFinding,
} from "./types.js";

export class PrivacyPolicyBlockedError extends Error {
  public readonly decision: PrivacyDecision;
  public readonly findings: SecretFinding[];

  constructor(message: string, decision: PrivacyDecision, findings: SecretFinding[]) {
    super(message);
    this.name = "PrivacyPolicyBlockedError";
    this.decision = decision;
    this.findings = findings;
  }
}

export interface PrepareContextOptions {
  changeContext: ChangeContext;
  privacyConfig?: PrivacyConfigOptions;
  providerLocation?: ProviderLocation;
  baseUrl?: string;
  allowRedactionOnBlock?: boolean;
}

const DEFAULT_REMOTE_POLICY: PrivacyActionPolicy = {
  highConfidence: "block",
  mediumConfidence: "redact",
  lowConfidence: "warn",
};

const DEFAULT_LOCAL_POLICY: PrivacyActionPolicy = {
  highConfidence: "redact",
  mediumConfidence: "redact",
  lowConfidence: "warn",
};

/**
 * Prepares and certifies a ChangeContext for safe AI transmission.
 * Remote AI transmission is strictly blocked or sanitized according to privacy policy.
 */
export async function prepareProviderContext(
  options: PrepareContextOptions,
): Promise<ProviderSafeContext> {
  const { changeContext } = options;
  const privacyConfig = options.privacyConfig ?? {};

  const location: ProviderLocation =
    options.providerLocation ??
    (options.baseUrl ? classifyProviderLocation(options.baseUrl) : "remote");

  const policy: PrivacyActionPolicy =
    location === "local"
      ? { ...DEFAULT_LOCAL_POLICY, ...privacyConfig.local }
      : { ...DEFAULT_REMOTE_POLICY, ...privacyConfig.remote };

  let findings: SecretFinding[] = [];
  if (privacyConfig.scanSecrets !== false) {
    const scanResult = await scanSensitiveContent(
      {
        patch: changeContext.patch,
        files: changeContext.files,
      },
      { config: privacyConfig },
    );
    findings = scanResult.findings;
  }

  const highFindings = findings.filter((f) => f.confidence === "high");
  const mediumFindings = findings.filter((f) => f.confidence === "medium");
  const lowFindings = findings.filter((f) => f.confidence === "low");

  let actionTaken: "none" | "redacted" | "blocked" | "warned" = "none";
  let state: "safe" | "sanitized" | "blocked" = "safe";
  const reasons: string[] = [];

  if (highFindings.length > 0) {
    if (policy.highConfidence === "block") {
      actionTaken = "blocked";
      state = "blocked";
      reasons.push(`${highFindings.length} high-confidence secret(s) detected with 'block' policy`);
    } else {
      actionTaken = "redacted";
      state = "sanitized";
      reasons.push(`${highFindings.length} high-confidence secret(s) detected and redacted`);
    }
  } else if (mediumFindings.length > 0) {
    if (policy.mediumConfidence === "block") {
      actionTaken = "blocked";
      state = "blocked";
      reasons.push(
        `${mediumFindings.length} medium-confidence secret(s) detected with 'block' policy`,
      );
    } else if (policy.mediumConfidence === "redact") {
      actionTaken = "redacted";
      state = "sanitized";
      reasons.push(`${mediumFindings.length} medium-confidence secret(s) detected and redacted`);
    } else {
      actionTaken = "warned";
      reasons.push(`${mediumFindings.length} medium-confidence secret(s) detected (warn policy)`);
    }
  } else if (lowFindings.length > 0) {
    if (policy.lowConfidence === "warn") {
      actionTaken = "warned";
      reasons.push(`${lowFindings.length} low-confidence secret(s) detected`);
    }
  }

  const decision: PrivacyDecision = {
    state,
    actionTaken,
    findingsCount: findings.length,
    highCount: highFindings.length,
    mediumCount: mediumFindings.length,
    lowCount: lowFindings.length,
    reasons,
  };

  if (decision.state === "blocked" && !options.allowRedactionOnBlock) {
    throw new PrivacyPolicyBlockedError(
      `Privacy Policy Blocked: Sensitive credentials detected in staged changes for ${location} provider.`,
      decision,
      findings,
    );
  }

  let finalContext = { ...changeContext };
  let redactions: RedactionRecord[] = [];

  // Redact if required or if allowRedactionOnBlock was chosen
  if (
    actionTaken === "redacted" ||
    (decision.state === "blocked" && options.allowRedactionOnBlock)
  ) {
    const redacted = redactChangeContext(changeContext, findings);
    finalContext = redacted.sanitizedContext;
    redactions = redacted.redactions;
  }

  // Remote Data Minimization
  let branchStripped = false;
  let repoNameStripped = false;
  let examplesStripped = false;

  if (location === "remote") {
    let updatedRepo = { ...finalContext.repository };
    if (!privacyConfig.sendBranchName) {
      updatedRepo = { ...updatedRepo, branch: null };
      branchStripped = true;
    }
    if (!privacyConfig.sendRepositoryName) {
      updatedRepo = { ...updatedRepo, name: "" };
      repoNameStripped = true;
    }
    finalContext = { ...finalContext, repository: updatedRepo };

    if (!privacyConfig.sendCommitExamples) {
      examplesStripped = true;
    }
  }

  const transmissionReport: ProviderTransmissionReport = {
    timestamp: new Date().toISOString(),
    providerLocation: location,
    filesCount: finalContext.files.length,
    bytesTotal: Buffer.byteLength(finalContext.patch, "utf8"),
    redactionsCount: redactions.length,
    branchStripped,
    repoNameStripped,
    examplesStripped,
  };

  return {
    changeContext: finalContext,
    providerLocation: location,
    decision,
    findings,
    redactions,
    isSanitized: redactions.length > 0,
    transmissionReport,
  };
}

export interface CommitMessageScanResult {
  safe: boolean;
  findings: SecretFinding[];
  placeholdersFound: string[];
  reasons: string[];
}

/**
 * Scans a generated or edited commit message to ensure that neither raw secrets
 * nor unresolved redaction placeholders leak into repository history.
 */
export async function scanCommitMessage(
  subject: string,
  body?: string,
  options?: { stagedFindings?: SecretFinding[] },
): Promise<CommitMessageScanResult> {
  const fullText = `${subject}\n\n${body ?? ""}`;
  const reasons: string[] = [];

  // 1. Scan text with detectors
  const scanResult = await scanSensitiveContent({ text: fullText });
  const findings = [...scanResult.findings];

  // 2. Check for echo of known staged secrets
  if (options?.stagedFindings) {
    for (const stagedFinding of options.stagedFindings) {
      if (
        stagedFinding.matchedText &&
        stagedFinding.matchedText.length >= 6 &&
        fullText.includes(stagedFinding.matchedText)
      ) {
        if (!findings.some((f) => f.matchedText === stagedFinding.matchedText)) {
          findings.push({
            ...stagedFinding,
            filePath: "commit-message",
            lineType: "message",
            description: `Echoed secret detected in commit message from ${stagedFinding.filePath}`,
          });
        }
      }
    }
  }

  // 3. Check for raw redaction placeholders appearing in subject or body
  const placeholderRegex = /<GITWHISPER_REDACTED_[A-Z_]+>/g;
  const placeholdersFound: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = placeholderRegex.exec(fullText)) !== null) {
    if (!placeholdersFound.includes(match[0])) {
      placeholdersFound.push(match[0]);
    }
  }

  if (findings.length > 0) {
    reasons.push(`Commit message contains ${findings.length} detected secret(s).`);
  }
  if (placeholdersFound.length > 0) {
    reasons.push(
      `Commit message contains unresolved redaction placeholder(s): ${placeholdersFound.join(", ")}`,
    );
  }

  return {
    safe: findings.length === 0 && placeholdersFound.length === 0,
    findings,
    placeholdersFound,
    reasons,
  };
}
