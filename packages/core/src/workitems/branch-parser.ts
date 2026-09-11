import { sanitizeTerminalString } from "../composer/sanitizer.js";
import type { BranchContext, WorkItemProviderId, WorkItemReference } from "./types.js";

// Common issue key regex: e.g. DEV-142, PROJ-872, ABC-1234
const JIRA_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

// GitHub issue pattern: GH-123 or #123
const GITHUB_PATTERN = /(?:^|[^a-zA-Z0-9])(?:GH-|#)(\d+)\b/gi;

// Number preceded by branch category, e.g. fix/123-auth, bugfix/456_login
const CATEGORY_NUMBER_PATTERN =
  /(?:feat|feature|fix|bugfix|hotfix|chore|refactor)[/-](\d+)(?:[-_]|$)/i;

// Semver pattern to reject: v1.2.3, 1.2.0-rc1
const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+/i;

// Date pattern to reject: 2026-09-08
const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;

// UUID pattern to reject
const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/**
 * Normalizes branch name to extract human-readable description hint.
 * e.g. "feature/DEV-142-session-timeout" -> "session timeout"
 */
export function extractBranchDescriptionHint(
  branchName: string,
  references: WorkItemReference[],
): string | undefined {
  let clean = branchName;

  // Remove common branch prefixes (e.g. feature/, bugfix/, users/alex/)
  clean = clean.replace(/^(?:users\/[^/]+\/|[a-zA-Z0-9_-]+\/)/, "");

  // Remove found issue keys
  for (const ref of references) {
    clean = clean.replace(new RegExp(ref.raw, "gi"), "");
    clean = clean.replace(new RegExp(ref.key, "gi"), "");
  }

  // Replace delimiters with spaces
  clean = clean.replace(/[-_./]+/g, " ").trim();

  // Remove leading numbers or leftover dashes
  clean = clean.replace(/^\d+\s*/, "").trim();

  return clean.length > 2 ? clean : undefined;
}

/**
 * Parses branch name and extracts work-item references conservatively.
 */
export function parseBranchContext(
  rawBranchName: string | null | undefined,
  customPatterns?: string[],
): BranchContext {
  if (!rawBranchName || rawBranchName.startsWith("(detached")) {
    return {
      name: rawBranchName ?? undefined,
      detached: true,
      references: [],
      confidence: "low",
    };
  }

  // Sanitize branch name against terminal/escape injection
  const branchName = sanitizeTerminalString(rawBranchName.trim());
  const foundReferences: WorkItemReference[] = [];
  const seenKeys = new Set<string>();

  // Check if branch name itself is a version or date
  if (
    SEMVER_PATTERN.test(branchName) ||
    DATE_PATTERN.test(branchName) ||
    UUID_PATTERN.test(branchName)
  ) {
    return {
      name: branchName,
      detached: false,
      references: [],
      confidence: "low",
    };
  }

  // 1. Check custom configured patterns first
  if (customPatterns && customPatterns.length > 0) {
    for (const pattern of customPatterns) {
      try {
        const regex = new RegExp(pattern, "g");
        let match: RegExpExecArray | null;
        while ((match = regex.exec(branchName)) !== null) {
          const raw = match[0];
          const key = match[1] ?? match[0];
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            foundReferences.push({
              raw,
              key,
              source: "config",
              confidence: "high",
            });
          }
        }
      } catch {
        // Safe regex execution: invalid custom regex ignored
      }
    }
  }

  // 2. Scan standard Jira/Linear uppercase patterns (e.g. DEV-142)
  let jiraMatch: RegExpExecArray | null;
  const jiraRegex = new RegExp(JIRA_PATTERN.source, "g");
  while ((jiraMatch = jiraRegex.exec(branchName)) !== null) {
    const raw = jiraMatch[1];
    let key = raw.toUpperCase();
    let providerHint: WorkItemProviderId | undefined;
    if (key.startsWith("GH-")) {
      key = `#${key.slice(3)}`;
      providerHint = "github";
    } else {
      providerHint = "jira";
    }
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      seenKeys.add(raw.toUpperCase());
      foundReferences.push({
        raw,
        key,
        providerHint,
        source: "branch",
        confidence: "high",
      });
    }
  }

  // 3. Scan GitHub patterns (e.g. GH-123 or #123)
  let ghMatch: RegExpExecArray | null;
  const ghRegex = new RegExp(GITHUB_PATTERN.source, "gi");
  while ((ghMatch = ghRegex.exec(branchName)) !== null) {
    const num = ghMatch[1];
    const key = `#${num}`;
    if (!seenKeys.has(key) && !seenKeys.has(`GH-${num}`)) {
      seenKeys.add(key);
      foundReferences.push({
        raw: ghMatch[0].trim(),
        key,
        providerHint: "github",
        source: "branch",
        confidence: "high",
      });
    }
  }

  // 4. Scan category-prefixed numbers: fix/123-something
  const catMatch = branchName.match(CATEGORY_NUMBER_PATTERN);
  if (catMatch) {
    const num = catMatch[1];
    const key = `#${num}`;
    if (!seenKeys.has(key) && !seenKeys.has(`GH-${num}`)) {
      seenKeys.add(key);
      foundReferences.push({
        raw: catMatch[0].trim(),
        key,
        providerHint: "github",
        source: "branch",
        confidence: "medium",
      });
    }
  }

  const normalizedDescription = extractBranchDescriptionHint(branchName, foundReferences);
  const confidence = foundReferences.length > 0 ? "high" : "low";

  return {
    name: branchName,
    detached: false,
    references: foundReferences,
    normalizedDescription,
    confidence,
  };
}
