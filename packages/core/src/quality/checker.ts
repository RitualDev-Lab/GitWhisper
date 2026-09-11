import { scanSensitiveContent } from "../privacy/scanner.js";
import type { ChangeContext } from "../types.js";
import { formatReferenceTrailer } from "../workitems/reference-formatter.js";
import { parseCommitMessage } from "./parser.js";
import type {
  CommitPolicy,
  CommitQualityCheckOptions,
  CommitQualityIssue,
  CommitQualityResult,
  ParsedCommit,
  QualityCheckItem,
  QualityRating,
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
  "updated stuff",
  "update stuff",
  "misc fixes",
  "misc changes",
  "minor changes",
  "code update",
  "updates",
  "stuff",
  "fixes",
  "testing",
  "test",
  "commit",
  "work in progress",
]);

/**
 * Deterministically checks a commit message against policy, staged evidence, and secret rules.
 */
export async function checkCommitQuality(
  options: CommitQualityCheckOptions,
): Promise<CommitQualityResult> {
  const { message, policy, changeContext, branchContext } = options;
  const issues: CommitQualityIssue[] = [];
  const checks: QualityCheckItem[] = [];

  const parsed = parseCommitMessage(message);

  // 1. Secret scanning (Phase 7 integration)
  const secretScan = await scanSensitiveContent({ text: message });
  if (secretScan.findings.length > 0) {
    for (const f of secretScan.findings) {
      issues.push({
        code: "SECRET_IN_COMMIT_MESSAGE",
        severity: "error",
        message: `Possible credential (${f.category}) detected in commit message. Commit messages are stored permanently in Git history.`,
        evidence: [f.maskedPreview],
      });
    }
    checks.push({
      name: "no-secret-leakage",
      passed: false,
      message: `Detected ${secretScan.findings.length} sensitive secret(s) in commit message.`,
    });
  } else {
    checks.push({
      name: "no-secret-leakage",
      passed: true,
    });
  }

  // 2. Empty message check
  if (!parsed.subject) {
    issues.push({
      code: "EMPTY_MESSAGE",
      severity: "error",
      message: "Commit message cannot be empty.",
    });
    checks.push({ name: "message-not-empty", passed: false });
    return buildResult("poor", 0, false, issues, checks, parsed, message, undefined);
  }
  checks.push({ name: "message-not-empty", passed: true });

  // 3. Subject length
  const maxLen = policy.maxSubjectLength || 72;
  if (parsed.subject.length > maxLen) {
    issues.push({
      code: "SUBJECT_TOO_LONG",
      severity: parsed.subject.length > 100 ? "error" : "warning",
      message: `Subject length (${parsed.subject.length} chars) exceeds maximum allowed length of ${maxLen} characters.`,
    });
    checks.push({
      name: "subject-length",
      passed: false,
      message: `Length: ${parsed.subject.length}/${maxLen}`,
    });
  } else {
    checks.push({ name: "subject-length", passed: true });
  }

  // 4. Trailing punctuation
  const trimmedDesc = parsed.description.trim();
  if (trimmedDesc.endsWith(".") || trimmedDesc.endsWith(";")) {
    issues.push({
      code: "TRAILING_PUNCTUATION",
      severity: "warning",
      message: "Commit subject lines should not end with a period or semicolon.",
    });
    checks.push({ name: "no-trailing-punctuation", passed: false });
  } else {
    checks.push({ name: "no-trailing-punctuation", passed: true });
  }

  // 5. Vague description check
  if (!policy.allowVagueDescriptions) {
    const norm = trimmedDesc
      .toLowerCase()
      .replace(/[.!?,;:]+$/, "")
      .trim();
    if (FORBIDDEN_VAGUE_DESCRIPTIONS.has(norm)) {
      issues.push({
        code: "VAGUE_DESCRIPTION",
        severity: options.strict ? "error" : "warning",
        message: `Subject "${parsed.description}" is too vague. Please describe the specific behavior change.`,
      });
      checks.push({
        name: "specific-description",
        passed: false,
        message: `Vague: "${parsed.description}"`,
      });
    } else {
      checks.push({ name: "specific-description", passed: true });
    }
  }

  // 6. Conventional commit rules & type validation
  const allowedTypes = new Set((policy.allowedTypes || []).map((t: string) => t.toLowerCase()));

  if (policy.style === "conventional") {
    if (!parsed.isConventional) {
      issues.push({
        code: "MISSING_CONVENTIONAL_TYPE",
        severity: "error",
        message:
          "Repository uses Conventional Commits, but message does not follow the format: type(scope): description.",
      });
      checks.push({ name: "conventional-syntax", passed: false });
    } else {
      checks.push({ name: "conventional-syntax", passed: true });
    }
  }

  if (parsed.type) {
    if (allowedTypes.size > 0 && !allowedTypes.has(parsed.type)) {
      issues.push({
        code: "INVALID_TYPE",
        severity: "error",
        message: `Commit type "${parsed.type}" is not in the allowed types list: ${Array.from(allowedTypes).join(", ")}.`,
      });
      checks.push({
        name: "type-valid",
        passed: false,
        message: `Type "${parsed.type}" not allowed.`,
      });
    } else {
      checks.push({ name: "type-valid", passed: true });
    }
  }

  // 7. Scope validation
  if (policy.requireScope) {
    if (!parsed.scope) {
      issues.push({
        code: "MISSING_SCOPE",
        severity: "error",
        message: "Commit scope is required by repository policy.",
      });
      checks.push({ name: "scope-present", passed: false });
    } else {
      checks.push({ name: "scope-present", passed: true });
    }
  }

  const scopeWhitelist =
    policy.requiredScopes && policy.requiredScopes.length > 0
      ? policy.requiredScopes
      : policy.strictScopes && policy.scopes && policy.scopes.length > 0
        ? policy.scopes
        : undefined;

  if (parsed.scope && scopeWhitelist) {
    const allowedScopes = new Set(scopeWhitelist.map((s: string) => s.toLowerCase()));
    if (!allowedScopes.has(parsed.scope.toLowerCase())) {
      issues.push({
        code: "DISALLOWED_SCOPE",
        severity: "error",
        message: `Scope "${parsed.scope}" is not in the allowed scopes list: ${scopeWhitelist.join(", ")}.`,
      });
      checks.push({
        name: "scope-allowed",
        passed: false,
        message: `Scope "${parsed.scope}" not in allowed list.`,
      });
    } else {
      checks.push({ name: "scope-allowed", passed: true });
    }
  }

  // 8. Breaking change explanation
  if (parsed.breaking) {
    const hasBreakingExplanation =
      parsed.body &&
      (parsed.body.includes("BREAKING CHANGE:") || parsed.body.includes("BREAKING-CHANGE:"));
    if (!hasBreakingExplanation) {
      issues.push({
        code: "MISSING_BREAKING_DETAILS",
        severity: "warning",
        message:
          "Commit marked as breaking change (!), but lacks a detailed BREAKING CHANGE: explanation in the body.",
      });
      checks.push({ name: "breaking-explanation", passed: false });
    } else {
      checks.push({ name: "breaking-explanation", passed: true });
    }
  }

  // 9. Work-item policy
  const hasTicketInTrailers = parsed.trailers.some(
    (t) =>
      /^(Refs|Fixes|Closes|Resolves)$/i.test(t.token) ||
      /\b([A-Z][A-Z0-9]+-\d+|#\d+|GH-\d+)\b/i.test(t.value),
  );
  const hasTicketInSubject = /\b([A-Z][A-Z0-9]+-\d+|#\d+|GH-\d+)\b/i.test(parsed.subject);
  const hasWorkItem = hasTicketInTrailers || hasTicketInSubject;

  if (policy.requireWorkItem) {
    if (!hasWorkItem) {
      issues.push({
        code: "MISSING_WORK_ITEM",
        severity: "error",
        message: "Commit is missing a required work-item reference (e.g. Refs DEV-123 or #123).",
      });
      checks.push({ name: "work-item-reference", passed: false });
    } else {
      checks.push({ name: "work-item-reference", passed: true });
    }
  }

  // 10. Evidence & Staged Changes Accuracy
  if (changeContext?.files && changeContext.files.length > 0) {
    const filePaths = changeContext.files.map((f) => f.path);
    const hasSource = changeContext.files.some((f) => f.category === "source");
    const hasDocs = changeContext.files.some((f) => f.category === "documentation");
    const hasTests = changeContext.files.some((f) => f.category === "test");
    const hasDocsOnly = hasDocs && !hasSource && !hasTests;
    const hasTestsOnly = hasTests && !hasSource && !hasDocs;

    // Feature / fix claimed on docs-only changes
    if ((parsed.type === "feat" || parsed.type === "fix") && hasDocsOnly) {
      issues.push({
        code: "EVIDENCE_MISMATCH",
        severity: "warning",
        message: `The commit message claims a "${parsed.type}" change, but the staged changes only contain documentation files.`,
        suggestion: `Consider using the "docs" commit type instead of "${parsed.type}".`,
        evidence: filePaths,
      });
      checks.push({
        name: "staged-evidence-match",
        passed: false,
        message: "Type contradicts docs-only diff.",
      });
    } else if ((parsed.type === "feat" || parsed.type === "fix") && hasTestsOnly) {
      issues.push({
        code: "EVIDENCE_MISMATCH",
        severity: "warning",
        message: `The commit message claims a "${parsed.type}" change, but the staged changes only contain test files.`,
        suggestion: `Consider using the "test" commit type instead of "${parsed.type}".`,
        evidence: filePaths,
      });
      checks.push({
        name: "staged-evidence-match",
        passed: false,
        message: "Type contradicts test-only diff.",
      });
    } else if (parsed.type === "test" && !hasTests) {
      issues.push({
        code: "EVIDENCE_MISMATCH",
        severity: "warning",
        message:
          'The commit message claims "test" changes, but no test files are modified in the staged changes.',
        suggestion: "Ensure test files are staged or adjust the commit type.",
        evidence: filePaths,
      });
      checks.push({
        name: "staged-evidence-match",
        passed: false,
        message: "Test type but no tests staged.",
      });
    } else if (parsed.type === "docs" && !hasDocs) {
      issues.push({
        code: "EVIDENCE_MISMATCH",
        severity: "warning",
        message:
          'The commit message claims "docs" changes, but no documentation files are modified in the staged changes.',
        suggestion: "Ensure documentation files are staged or adjust the commit type.",
        evidence: filePaths,
      });
      checks.push({
        name: "staged-evidence-match",
        passed: false,
        message: "Docs type but no docs staged.",
      });
    } else {
      checks.push({ name: "staged-evidence-match", passed: true });
    }

    // Scope directory match check
    if (parsed.scope && parsed.scope.length > 1) {
      const scopeLower = parsed.scope.toLowerCase();
      const scopeMatchesAnyPath = filePaths.some((p) => {
        const pLower = p.toLowerCase();
        return (
          pLower.includes(`/${scopeLower}/`) ||
          pLower.startsWith(`${scopeLower}/`) ||
          pLower.includes(scopeLower)
        );
      });
      if (!scopeMatchesAnyPath) {
        issues.push({
          code: "EVIDENCE_SCOPE_MISMATCH",
          severity: "suggestion",
          message: `The commit scope "${parsed.scope}" does not match any changed file paths in the staged changes.`,
          evidence: filePaths,
        });
      }
    }
  }

  // 11. Suggest correction
  const suggested = buildSuggestedCommit(parsed, policy, changeContext, branchContext);

  // 12. Rating & Score calculation
  let score = 100;
  let hasErrors = false;
  let hasWarnings = false;

  for (const issue of issues) {
    if (issue.severity === "error") {
      score -= 35;
      hasErrors = true;
    } else if (issue.severity === "warning") {
      score -= 15;
      hasWarnings = true;
    } else if (issue.severity === "suggestion") {
      score -= 5;
    }
  }

  score = Math.max(0, Math.min(100, score));

  let rating: QualityRating;
  if (hasErrors || score < 60) {
    rating = "poor";
  } else if (hasWarnings || score < 85) {
    rating = "needs-improvement";
  } else if (score < 95) {
    rating = "good";
  } else {
    rating = "excellent";
  }

  const valid = !hasErrors;

  return buildResult(rating, score, valid, issues, checks, parsed, message, suggested);
}

function buildSuggestedCommit(
  parsed: ParsedCommit,
  policy: CommitPolicy,
  changeContext?: ChangeContext,
  branchContext?: any,
): { subject: string; body?: string } | undefined {
  // Infer type
  let type = parsed.type;
  if (!type || !policy.allowedTypes.includes(type)) {
    if (changeContext?.files && changeContext.files.length > 0) {
      const hasDocs = changeContext.files.some((f) => f.category === "documentation");
      const hasSource = changeContext.files.some((f) => f.category === "source");
      const hasTests = changeContext.files.some((f) => f.category === "test");
      if (hasDocs && !hasSource) {
        type = "docs";
      } else if (hasTests && !hasSource) {
        type = "test";
      } else {
        type = "feat";
      }
    } else {
      type = "fix";
    }
  }

  // Infer scope
  let scope = parsed.scope;
  if (!scope && policy.requireScope && changeContext?.files && changeContext.files.length > 0) {
    const firstPath = changeContext.files[0].path;
    const parts = firstPath
      .split(/[\/\\]/)
      .filter((p) => p && !["src", "lib", "packages", "apps"].includes(p));
    if (parts.length > 1) {
      scope = parts[0].toLowerCase();
    } else {
      scope = "core";
    }
  }

  // Description
  let desc = parsed.description.trim().replace(/[.;]+$/, "");
  const norm = desc.toLowerCase();
  if (FORBIDDEN_VAGUE_DESCRIPTIONS.has(norm) || !desc) {
    if (branchContext?.normalizedDescription) {
      desc = branchContext.normalizedDescription;
    } else if (changeContext && changeContext.files.length > 0) {
      desc = `update ${changeContext.files[0].path.split(/[\/\\]/).pop()}`;
    } else {
      desc = "update components";
    }
  }

  const breakingMarker = parsed.breaking ? "!" : "";
  let subject: string;
  if (policy.style === "simple") {
    subject = desc;
  } else if (scope) {
    subject = `${type}(${scope})${breakingMarker}: ${desc}`;
  } else {
    subject = `${type}${breakingMarker}: ${desc}`;
  }

  let body = parsed.body;
  // If work-item is missing and branch has references, add trailer
  if (policy.requireWorkItem && branchContext?.references && branchContext.references.length > 0) {
    const refKey = branchContext.references[0].key;
    const trailer = formatReferenceTrailer(refKey);
    if (!body) {
      body = trailer;
    } else if (!body.includes(refKey)) {
      body = `${body}\n\n${trailer}`;
    }
  }

  return { subject, body };
}

function buildResult(
  rating: QualityRating,
  score: number,
  valid: boolean,
  issues: CommitQualityIssue[],
  checks: QualityCheckItem[],
  parsedCommit: ParsedCommit,
  rawMessage: string,
  suggested?: { subject: string; body?: string },
): CommitQualityResult {
  const suggestedMessage = suggested
    ? suggested.body
      ? `${suggested.subject}\n\n${suggested.body}`
      : suggested.subject
    : undefined;

  return {
    rating,
    score,
    valid,
    issues,
    checks,
    suggested,
    suggestedMessage,
    rawMessage,
    parsedCommit,
  };
}
