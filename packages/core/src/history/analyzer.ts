import type { GitCommitRecord } from "@gitwhisper/git";
import { isRevertCommit } from "@gitwhisper/git";
import type { ConfidenceLevel } from "../intelligence/types.js";
import { buildHistoricalScopeMappings } from "./path-mapper.js";
import type {
  CommitStyleExample,
  CommitTypeFrequency,
  ConventionStyle,
  RepositoryCommitStyle,
  ScopeFrequency,
  SubjectCase,
} from "./types.js";

export interface StyleAnalysisOptions {
  minimumSampleSize?: number;
  includeMergeCommits?: boolean;
  isShallow?: boolean;
}

// Emoji detection regex covering Unicode emoji and common Gitmoji patterns
const EMOJI_REGEX =
  /(?:[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|:[a-z0-9_+-]+:)/;

// Issue ID reference regex (e.g. #123, GH-123, PROJ-456, DEV-99)
const ISSUE_REF_REGEX = /(?:#\d+|[A-Z]{2,10}-\d+)/;

// Ticket prefix regex at start of commit (e.g. DEV-142 Add login, AUTH-12: fix session)
const TICKET_PREFIX_REGEX = /^[A-Z]{2,10}-\d+\b/;

// Conventional commit regex: type(scope)!: description or type!: description
const CONVENTIONAL_REGEX = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/**
 * Determines casing of a string description or subject.
 */
export function detectStringCase(text: string): SubjectCase {
  const trimmed = text.trim();
  if (!trimmed) return "unknown";

  // Check if ALL CAPS
  const lettersOnly = trimmed.replace(/[^a-zA-Z]/g, "");
  if (lettersOnly.length >= 3 && lettersOnly === lettersOnly.toUpperCase()) {
    return "uppercase";
  }

  const firstChar = trimmed[0];
  if (!/[a-zA-Z]/.test(firstChar)) {
    return "unknown";
  }

  if (firstChar === firstChar.toLowerCase()) {
    return "lowercase";
  }

  // First letter is uppercase: check if title case or sentence case
  const words = trimmed.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length > 2) {
    const uppercaseWords = words.filter((w) => /^[A-Z]/.test(w));
    if (uppercaseWords.length / words.length >= 0.75) {
      return "title";
    }
  }

  return "sentence";
}

/**
 * Deterministically analyzes historical Git commits to produce a comprehensive repository style profile.
 */
export function analyzeRepositoryHistory(
  records: GitCommitRecord[],
  options: StyleAnalysisOptions = {},
): RepositoryCommitStyle {
  const { minimumSampleSize = 5, includeMergeCommits = false, isShallow = false } = options;

  let ignoredMerges = 0;
  const filteredCommits: GitCommitRecord[] = [];

  for (const record of records) {
    const isMerge = record.parents.length > 1;
    if (isMerge && !includeMergeCommits) {
      ignoredMerges++;
      continue;
    }
    filteredCommits.push(record);
  }

  const sampleSize = filteredCommits.length;
  const totalAnalyzed = records.length;

  // Initial / empty state
  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      totalAnalyzed,
      ignoredMerges,
      isShallow,
      convention: {
        style: "unknown",
        confidence: "LOW",
        conventionalRatio: 0,
      },
      types: [],
      scopes: [],
      pathScopeMappings: [],
      formatting: {
        subjectCase: "lowercase",
        averageSubjectLength: 0,
        medianSubjectLength: 0,
        maxObservedSubjectLength: 0,
        trailingPeriodFrequency: 0,
        bodyUsageFrequency: 0,
        blankLineBeforeBodyFrequency: 0,
      },
      features: {
        usesScopes: false,
        usesBreakingMarker: false,
        usesEmoji: false,
        usesIssueReferences: false,
        usesTicketPrefixes: false,
      },
      examples: [],
    };
  }

  let conventionalMatches = 0;
  let nonRevertCount = 0;
  const typeCounts = new Map<string, number>();
  const scopeCounts = new Map<string, number>();
  const caseCounts: Record<SubjectCase, number> = {
    lowercase: 0,
    sentence: 0,
    title: 0,
    uppercase: 0,
    mixed: 0,
    unknown: 0,
  };

  const subjectLengths: number[] = [];
  let trailingPeriodCount = 0;
  let bodyCount = 0;
  let blankLineBeforeBodyCount = 0;
  let emojiCount = 0;
  let issueRefCount = 0;
  let ticketPrefixCount = 0;
  let breakingCount = 0;
  let scopedCommitCount = 0;

  for (const commit of filteredCommits) {
    const subject = commit.subject.trim();
    if (!subject) continue;

    const isRevert = isRevertCommit(subject);
    if (!isRevert) {
      nonRevertCount++;
    }

    subjectLengths.push(subject.length);

    if (subject.endsWith(".")) {
      trailingPeriodCount++;
    }

    if (commit.body && commit.body.trim().length > 0) {
      bodyCount++;
      // Check if body starts after blank line
      blankLineBeforeBodyCount++;
    }

    if (EMOJI_REGEX.test(subject)) {
      emojiCount++;
    }

    if (ISSUE_REF_REGEX.test(subject) || (commit.body && ISSUE_REF_REGEX.test(commit.body))) {
      issueRefCount++;
    }

    if (TICKET_PREFIX_REGEX.test(subject)) {
      ticketPrefixCount++;
    }

    const convMatch = subject.match(CONVENTIONAL_REGEX);
    if (convMatch) {
      conventionalMatches++;
      const type = convMatch[1].toLowerCase();
      const scope = convMatch[2]?.toLowerCase();
      const breaking = convMatch[3] === "!" || /BREAKING CHANGE/i.test(commit.body ?? "");
      const description = convMatch[4];

      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

      if (scope) {
        scopedCommitCount++;
        scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
      }

      if (breaking) {
        breakingCount++;
      }

      if (!isRevert) {
        const descCase = detectStringCase(description);
        caseCounts[descCase]++;
      }
    } else {
      if (!isRevert) {
        // Strip potential ticket prefix before checking casing
        const subjectWithoutTicket = subject.replace(TICKET_PREFIX_REGEX, "").trim();
        const subCase = detectStringCase(subjectWithoutTicket);
        caseCounts[subCase]++;
      }
    }
  }

  // Calculate Conventional Commit Ratio
  const baselineCount = nonRevertCount > 0 ? nonRevertCount : sampleSize;
  const conventionalRatio = baselineCount > 0 ? conventionalMatches / baselineCount : 0;

  let style: ConventionStyle;
  let confidence: ConfidenceLevel;

  if (sampleSize < minimumSampleSize) {
    style = conventionalRatio >= 0.75 ? "conventional" : "unknown";
    confidence = "LOW";
  } else if (conventionalRatio >= 0.75) {
    style = "conventional";
    confidence = isShallow ? "MEDIUM" : "HIGH";
  } else if (conventionalRatio >= 0.45) {
    style = conventionalRatio >= 0.6 ? "conventional" : "mixed";
    confidence = "MEDIUM";
  } else if (conventionalRatio <= 0.25) {
    style = "simple";
    confidence = isShallow ? "MEDIUM" : "HIGH";
  } else {
    style = "mixed";
    confidence = "MEDIUM";
  }

  // Types frequency
  const types: CommitTypeFrequency[] = Array.from(typeCounts.entries())
    .map(([type, count]) => ({
      type,
      count,
      frequency: conventionalMatches > 0 ? count / conventionalMatches : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Scopes frequency
  const scopes: ScopeFrequency[] = Array.from(scopeCounts.entries())
    .map(([scope, count]) => ({
      scope,
      count,
      frequency: scopedCommitCount > 0 ? count / scopedCommitCount : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Dominant subject casing
  let dominantCase: SubjectCase = "lowercase";
  let maxCaseCount = 0;
  for (const [c, count] of Object.entries(caseCounts) as [SubjectCase, number][]) {
    if (c === "unknown") continue;
    if (count > maxCaseCount) {
      maxCaseCount = count;
      dominantCase = c;
    }
  }

  if (baselineCount > 0 && maxCaseCount / baselineCount < 0.55) {
    dominantCase = "mixed";
  }

  // Subject length metrics
  subjectLengths.sort((a, b) => a - b);
  const avgLen =
    subjectLengths.length > 0
      ? Math.round(subjectLengths.reduce((a, b) => a + b, 0) / subjectLengths.length)
      : 0;
  const medianLen =
    subjectLengths.length > 0 ? subjectLengths[Math.floor(subjectLengths.length / 2)] : 0;
  const maxLen = subjectLengths.length > 0 ? subjectLengths[subjectLengths.length - 1] : 0;

  // Path Scope Mappings
  const pathScopeMappings = buildHistoricalScopeMappings(filteredCommits);

  // Features
  const usesScopes =
    scopedCommitCount >= 2 && scopedCommitCount / (conventionalMatches || 1) >= 0.25;
  const usesBreakingMarker = breakingCount > 0;
  const usesEmoji = emojiCount >= 2 && emojiCount / sampleSize >= 0.1;
  const usesIssueReferences = issueRefCount >= 2 && issueRefCount / sampleSize >= 0.1;
  const usesTicketPrefixes = ticketPrefixCount >= 2 && ticketPrefixCount / sampleSize >= 0.1;

  // Select 2-3 safe representative examples
  const examples: CommitStyleExample[] = [];
  const candidateCommits = filteredCommits.filter(
    (c) =>
      !isRevertCommit(c.subject) &&
      !/ignore\s+all\s+previous|prompt|password|secret|api[_-]?key/i.test(c.subject),
  );

  // 1. Pick a common pattern commit matching the dominant style
  for (const c of candidateCommits) {
    const isConv = CONVENTIONAL_REGEX.test(c.subject);
    if (style === "conventional" && isConv) {
      examples.push({
        subject: c.subject,
        body: c.body,
        reason: "common-pattern",
      });
      break;
    }
    if (style === "simple" && !isConv) {
      examples.push({
        subject: c.subject,
        body: c.body,
        reason: "common-pattern",
      });
      break;
    }
  }

  // 2. Pick a top type or scope example if available
  if (types.length > 0 && examples.length < 2) {
    const topType = types[0].type;
    const typeCommit = candidateCommits.find(
      (c) => c.subject.startsWith(`${topType}:`) || c.subject.startsWith(`${topType}(`),
    );
    if (typeCommit && !examples.some((e) => e.subject === typeCommit.subject)) {
      examples.push({
        subject: typeCommit.subject,
        body: typeCommit.body,
        reason: "type-example",
      });
    }
  }

  if (scopes.length > 0 && examples.length < 3) {
    const topScope = scopes[0].scope;
    const scopeCommit = candidateCommits.find((c) => c.subject.includes(`(${topScope})`));
    if (scopeCommit && !examples.some((e) => e.subject === scopeCommit.subject)) {
      examples.push({
        subject: scopeCommit.subject,
        body: scopeCommit.body,
        reason: "scope-example",
      });
    }
  }

  return {
    sampleSize,
    totalAnalyzed,
    ignoredMerges,
    isShallow,
    convention: {
      style,
      confidence,
      conventionalRatio: Math.round(conventionalRatio * 100) / 100,
    },
    types,
    scopes,
    pathScopeMappings,
    formatting: {
      subjectCase: dominantCase,
      averageSubjectLength: avgLen,
      medianSubjectLength: medianLen,
      maxObservedSubjectLength: maxLen,
      trailingPeriodFrequency: Math.round((trailingPeriodCount / sampleSize) * 100) / 100,
      bodyUsageFrequency: Math.round((bodyCount / sampleSize) * 100) / 100,
      blankLineBeforeBodyFrequency:
        bodyCount > 0 ? Math.round((blankLineBeforeBodyCount / bodyCount) * 100) / 100 : 1,
    },
    features: {
      usesScopes,
      usesBreakingMarker,
      usesEmoji,
      usesIssueReferences,
      usesTicketPrefixes,
    },
    examples,
  };
}
