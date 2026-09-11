import {
  type CommitProposal,
  type CommitValidationResult,
  DEFAULT_CONVENTIONAL_TYPES,
  type ValidationIssue,
  type ValidationRules,
} from "./types.js";

const FORBIDDEN_VAGUE_DESCRIPTIONS = new Set([
  "update files",
  "updating files",
  "update file",
  "make changes",
  "making changes",
  "fix stuff",
  "various improvements",
  "code updates",
  "changes",
  "minor fixes",
  "small changes",
  "wip",
  "temp",
  "cleanup",
  "fix bug",
  "fix issue",
  "update code",
  "changes made",
  "refactoring",
]);

/**
 * Formats a CommitProposal into a Conventional Commit subject line.
 * e.g. `feat(auth): validate session expiry` or `feat(auth)!: breaking change`
 */
export function formatCommitSubject(proposal: {
  type: string;
  scope?: string;
  description: string;
  breaking?: boolean;
}): string {
  const type = proposal.type.trim().toLowerCase();
  const rawScope = proposal.scope?.trim().toLowerCase();
  const scope = rawScope && rawScope !== "none" ? rawScope : undefined;
  const breakingMarker = proposal.breaking ? "!" : "";
  const desc = proposal.description.trim().replace(/\.$/, ""); // strip trailing period

  if (type === "simple") {
    return desc;
  }

  if (scope) {
    return `${type}(${scope})${breakingMarker}: ${desc}`;
  }
  return `${type}${breakingMarker}: ${desc}`;
}

/**
 * Deterministically validates a proposed commit message and its components against rules.
 */
export function validateCommitProposal(
  proposal: CommitProposal,
  rules: ValidationRules = {},
): CommitValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const allowedTypes = new Set(
    (rules.allowedTypes || DEFAULT_CONVENTIONAL_TYPES).map((t) => t.toLowerCase()),
  );
  const maxSubjectLength = rules.maxSubjectLength || 72;

  // 1. Validate Type
  const type = proposal.type?.trim().toLowerCase();
  if (!type) {
    errors.push({
      code: "MISSING_TYPE",
      message: "Commit type is required.",
      field: "type",
    });
  } else if (type !== "simple" && !allowedTypes.has(type)) {
    errors.push({
      code: "INVALID_TYPE",
      message: `Unknown commit type "${type}". Allowed types: ${Array.from(allowedTypes).join(", ")}.`,
      field: "type",
    });
  }

  // 2. Validate Scope
  const rawScope = proposal.scope?.trim().toLowerCase();
  const hasScope = rawScope && rawScope !== "none";

  if (rules.requireScope && !hasScope) {
    errors.push({
      code: "SCOPE_REQUIRED",
      message: "A commit scope is required by repository configuration.",
      field: "scope",
    });
  }

  if (hasScope && rules.strictScopes && rules.allowedScopes && rules.allowedScopes.length > 0) {
    const allowedScopes = new Set(rules.allowedScopes.map((s) => s.toLowerCase()));
    if (!allowedScopes.has(rawScope)) {
      errors.push({
        code: "INVALID_SCOPE",
        message: `Scope "${rawScope}" is not in the allowed scopes list: ${rules.allowedScopes.join(", ")}.`,
        field: "scope",
      });
    }
  }

  // 3. Validate Description
  const description = proposal.description?.trim();
  if (!description) {
    errors.push({
      code: "EMPTY_DESCRIPTION",
      message: "Commit description cannot be empty.",
      field: "description",
    });
  } else {
    if (description.includes("\n") || description.includes("\r")) {
      errors.push({
        code: "MULTILINE_DESCRIPTION",
        message: "Commit description must be a single line.",
        field: "description",
      });
    }

    if (description.endsWith(".")) {
      warnings.push({
        code: "TRAILING_PERIOD",
        message:
          "Commit subject lines should not end with a period (will be automatically stripped).",
        field: "description",
      });
    }

    // Check for vague descriptions
    if (!rules.allowVagueDescriptions) {
      const normalizedDesc = description.toLowerCase().replace(/[.!?,;:]+$/, "");
      if (FORBIDDEN_VAGUE_DESCRIPTIONS.has(normalizedDesc)) {
        errors.push({
          code: "VAGUE_DESCRIPTION",
          message: `Description "${description}" is too vague. Please provide specific detail on what changed.`,
          field: "description",
        });
      }
    }
  }

  // 4. Formatted Subject Validation
  const formattedSubject = formatCommitSubject(proposal);

  if (formattedSubject.length > maxSubjectLength) {
    if (formattedSubject.length > 100) {
      errors.push({
        code: "SUBJECT_TOO_LONG",
        message: `Subject length (${formattedSubject.length} chars) exceeds maximum allowed length of ${maxSubjectLength} characters.`,
        field: "subject",
      });
    } else {
      warnings.push({
        code: "SUBJECT_LENGTH_WARNING",
        message: `Subject length (${formattedSubject.length} chars) exceeds recommended limit of ${maxSubjectLength} characters.`,
        field: "subject",
      });
    }
  }

  // 5. Breaking change checks
  if (
    proposal.breaking &&
    !proposal.breakingDescription &&
    !proposal.body?.includes("BREAKING CHANGE")
  ) {
    warnings.push({
      code: "MISSING_BREAKING_DETAILS",
      message: "Commit marked as breaking change, but no breaking description was specified.",
      field: "breaking",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    formattedSubject,
  };
}
