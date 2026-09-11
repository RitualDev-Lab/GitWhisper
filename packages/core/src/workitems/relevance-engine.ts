import type { ChangeContext, ClassifiedFileChange } from "../types.js";
import type { BranchContext, IntentEvidence, IntentRelevance, WorkItem } from "./types.js";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "in",
  "to",
  "for",
  "with",
  "of",
  "on",
  "at",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "can",
  "could",
  "add",
  "update",
  "fix",
  "make",
]);

/**
 * Tokenizes text into normalized keywords, filtering common stop words.
 */
export function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Evaluates the relevance of a work item and branch context against the staged change context.
 */
export function evaluateIntentRelevance(
  workItem: WorkItem | undefined,
  branch: BranchContext | undefined,
  context: ChangeContext,
): { relevance: IntentRelevance; evidence: IntentEvidence[] } {
  const evidence: IntentEvidence[] = [];

  // 1. Gather tokens from staged files and directories
  const stagedPathTokens = new Set<string>();
  for (const f of context.files) {
    const parts = f.path.toLowerCase().split(/[/\\._-]+/);
    for (const p of parts) {
      if (p.length > 2 && !STOP_WORDS.has(p)) {
        stagedPathTokens.add(p);
      }
    }
  }

  // 2. Evaluate Work Item Title & Labels
  let workItemTokenMatches = 0;

  if (workItem?.title) {
    const titleTokens = tokenize(workItem.title);

    for (const token of titleTokens) {
      if (stagedPathTokens.has(token)) {
        workItemTokenMatches++;
        evidence.push({
          signal: "file-path-overlap",
          strength: "strong",
          description: `Staged files overlap with work-item term: "${token}"`,
        });
      }
    }

    // Check scope overlap from intelligence
    const candidateScopes = context.intelligence?.probableScopes || [];
    for (const sc of candidateScopes) {
      if (titleTokens.has(sc.scope.toLowerCase())) {
        evidence.push({
          signal: "scope-match",
          strength: "strong",
          description: `Staged scope "${sc.scope}" matches work-item title term.`,
        });
      }
    }
  }

  // 3. Evaluate Work Item Labels vs Staged Characteristics
  if (workItem?.labels && workItem.labels.length > 0) {
    const lowerLabels = workItem.labels.map((l) => l.toLowerCase());
    if (lowerLabels.some((l) => l.includes("doc")) && context.characteristics.hasDocumentation) {
      evidence.push({
        signal: "label-match",
        strength: "moderate",
        description: "Documentation label matches staged documentation changes.",
      });
    }
    if (lowerLabels.some((l) => l.includes("test")) && context.characteristics.hasTests) {
      evidence.push({
        signal: "label-match",
        strength: "moderate",
        description: "Test label matches staged test files.",
      });
    }
    if (lowerLabels.some((l) => l.includes("bug") || l.includes("fix"))) {
      evidence.push({
        signal: "label-match",
        strength: "moderate",
        description: "Bug/fix label corresponds to fix intent.",
      });
    }
  }

  // 4. Evaluate Branch Description Hint
  if (branch?.normalizedDescription) {
    const branchTokens = tokenize(branch.normalizedDescription);
    let branchMatches = 0;
    for (const token of branchTokens) {
      if (stagedPathTokens.has(token)) {
        branchMatches++;
      }
    }
    if (branchMatches > 0) {
      evidence.push({
        signal: "branch-name-overlap",
        strength: "moderate",
        description: `Staged files overlap with branch description: "${branch.normalizedDescription}"`,
      });
    }
  }

  // 5. Detect Obvious Conflicts (e.g. work item is about code feature, but change is docs-only)
  const isDocsOnly =
    context.characteristics.hasDocumentation &&
    !context.characteristics.hasTests &&
    context.files.every(
      (f: ClassifiedFileChange) =>
        f.path.toLowerCase().endsWith(".md") || f.path.toLowerCase().startsWith("docs/"),
    );

  if (isDocsOnly && workItem?.title) {
    const titleLower = workItem.title.toLowerCase();
    const isDocsTicket = titleLower.includes("doc") || titleLower.includes("readme");
    if (!isDocsTicket && workItemTokenMatches === 0) {
      evidence.push({
        signal: "docs-conflict",
        strength: "strong",
        description:
          "Staged change is documentation-only, but work item appears to specify code/feature implementation.",
      });
      return { relevance: "low", evidence };
    }
  }

  // 6. Compute Final Relevance
  if (evidence.some((e) => e.signal === "docs-conflict")) {
    return { relevance: "low", evidence };
  }

  if (workItemTokenMatches >= 2 || (workItemTokenMatches >= 1 && evidence.length >= 2)) {
    return { relevance: "high", evidence };
  }

  if (workItemTokenMatches === 1 || evidence.length >= 1) {
    return { relevance: "medium", evidence };
  }

  if (workItem) {
    return { relevance: "low", evidence };
  }

  if (branch?.references && branch.references.length > 0) {
    return { relevance: "medium", evidence };
  }

  return { relevance: "unknown", evidence };
}
