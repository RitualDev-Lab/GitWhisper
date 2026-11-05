/**
 * Enterprise Jira & Linear Issue Key Governance Validator
 *
 * Enforces corporate issue key compliance (Jira and Linear) on commit messages
 * and branch names, verifying that developer commits link to valid sprint work-items.
 */

export interface EnterpriseIssueKeyPolicy {
  required?: boolean;
  format?: "jira" | "linear" | "both" | "custom";
  allowedPrefixes?: string[];
  customPattern?: string;
  allowBypassWithNoTicket?: boolean;
}

export interface IssueKeyValidationResult {
  valid: boolean;
  detectedKeys: string[];
  provider: "jira" | "linear" | "custom" | "none";
  error?: string;
  formattedReference?: string;
}

const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9_]{1,10}-\d+)\b/g;
const LINEAR_KEY_REGEX = /\b([A-Z]{2,10}-\d+)\b/g;

export class EnterpriseIssueKeyValidator {
  private policy: EnterpriseIssueKeyPolicy;

  constructor(policy: EnterpriseIssueKeyPolicy = {}) {
    this.policy = {
      required: policy.required ?? false,
      format: policy.format ?? "both",
      allowedPrefixes: policy.allowedPrefixes,
      customPattern: policy.customPattern,
      allowBypassWithNoTicket: policy.allowBypassWithNoTicket ?? false,
    };
  }

  /**
   * Validates a commit message or branch name against enterprise issue key policy
   */
  public validate(messageOrBranch: string): IssueKeyValidationResult {
    if (!messageOrBranch || messageOrBranch.trim().length === 0) {
      if (this.policy.required) {
        return {
          valid: false,
          detectedKeys: [],
          provider: "none",
          error:
            "Enterprise Policy Violation: Commit message is empty and lacks required issue key.",
        };
      }
      return { valid: true, detectedKeys: [], provider: "none" };
    }

    // Check if bypass flag [no-ticket] or [skip-issue] is allowed
    if (
      this.policy.allowBypassWithNoTicket &&
      /\[(?:no-ticket|skip-issue|no-issue)\]/i.test(messageOrBranch)
    ) {
      return {
        valid: true,
        detectedKeys: [],
        provider: "none",
        formattedReference: "[no-ticket]",
      };
    }

    const detectedKeys = this.extractKeys(messageOrBranch);

    // If no keys found:
    if (detectedKeys.length === 0) {
      if (this.policy.required) {
        const allowed = this.policy.allowedPrefixes
          ? ` (allowed prefixes: ${this.policy.allowedPrefixes.join(", ")})`
          : "";
        return {
          valid: false,
          detectedKeys: [],
          provider: "none",
          error: `Enterprise Policy Violation: Commit message or branch must include a valid ${this.policy.format?.toUpperCase()} issue key${allowed}. Example: 'PROJ-123: fix login authentication'`,
        };
      }
      return { valid: true, detectedKeys: [], provider: "none" };
    }

    // If allowedPrefixes is configured, ensure at least one detected key matches
    if (this.policy.allowedPrefixes && this.policy.allowedPrefixes.length > 0) {
      const upperAllowed = new Set(this.policy.allowedPrefixes.map((p) => p.toUpperCase()));
      const validPrefixKeys = detectedKeys.filter((k) => {
        const prefix = k.split("-")[0].toUpperCase();
        return upperAllowed.has(prefix);
      });

      if (validPrefixKeys.length === 0) {
        return {
          valid: false,
          detectedKeys,
          provider: this.classifyProvider(detectedKeys[0]),
          error: `Enterprise Policy Violation: Issue key(s) [${detectedKeys.join(", ")}] do not match allowed enterprise prefixes: [${this.policy.allowedPrefixes.join(", ")}]`,
        };
      }

      return {
        valid: true,
        detectedKeys: validPrefixKeys,
        provider: this.classifyProvider(validPrefixKeys[0]),
        formattedReference: validPrefixKeys[0],
      };
    }

    return {
      valid: true,
      detectedKeys,
      provider: this.classifyProvider(detectedKeys[0]),
      formattedReference: detectedKeys[0],
    };
  }

  private extractKeys(text: string): string[] {
    const keys: string[] = [];

    if (this.policy.customPattern) {
      const customRegex = new RegExp(this.policy.customPattern, "g");
      let m = customRegex.exec(text);
      while (m !== null) {
        keys.push(m[1] || m[0]);
        m = customRegex.exec(text);
      }
      return Array.from(new Set(keys));
    }

    if (this.policy.format === "jira" || this.policy.format === "both") {
      JIRA_KEY_REGEX.lastIndex = 0;
      let m = JIRA_KEY_REGEX.exec(text);
      while (m !== null) {
        keys.push(m[1]);
        m = JIRA_KEY_REGEX.exec(text);
      }
    }

    if (this.policy.format === "linear" || this.policy.format === "both") {
      LINEAR_KEY_REGEX.lastIndex = 0;
      let m = LINEAR_KEY_REGEX.exec(text);
      while (m !== null) {
        // Exclude semver or common false positives
        if (!keys.includes(m[1])) {
          keys.push(m[1]);
        }
        m = LINEAR_KEY_REGEX.exec(text);
      }
    }

    return Array.from(new Set(keys));
  }

  private classifyProvider(key: string): "jira" | "linear" | "custom" | "none" {
    if (!key) return "none";
    if (this.policy.customPattern) return "custom";
    if (this.policy.format === "linear") return "linear";
    if (this.policy.format === "jira") return "jira";
    // If both, heuristic based on prefix length
    const prefix = key.split("-")[0];
    return prefix.length <= 4 ? "linear" : "jira";
  }
}
