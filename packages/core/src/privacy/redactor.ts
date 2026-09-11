import type { ChangeContext } from "../types.js";
import type { RedactionRecord, SecretFinding } from "./types.js";

export interface RedactPatchResult {
  sanitizedPatch: string;
  redactions: RedactionRecord[];
}

/**
 * Redacts detected secrets from a git unified diff patch while preserving
 * diff line structure, hunk markers, and surrounding context.
 * Redacts secrets in both added (+) and deleted (-) lines.
 */
export function redactPatch(patch: string, findings: SecretFinding[]): RedactPatchResult {
  if (!patch || findings.length === 0) {
    return { sanitizedPatch: patch, redactions: [] };
  }

  // Sort findings by matchedText length descending to prevent sub-string collision
  const sortedFindings = [...findings].sort((a, b) => b.matchedText.length - a.matchedText.length);

  let sanitizedPatch = patch;
  const redactions: RedactionRecord[] = [];
  const recordedKeys = new Set<string>();

  for (const finding of sortedFindings) {
    if (!finding.matchedText || finding.matchedText.length === 0) continue;

    if (sanitizedPatch.includes(finding.matchedText)) {
      sanitizedPatch = sanitizedPatch.replaceAll(finding.matchedText, finding.placeholder);

      const recordKey = `${finding.filePath}:${finding.lineNumber}:${finding.placeholder}`;
      if (!recordedKeys.has(recordKey)) {
        recordedKeys.add(recordKey);
        redactions.push({
          category: finding.category,
          filePath: finding.filePath,
          lineNumber: finding.lineNumber,
          placeholder: finding.placeholder,
          maskedPreview: finding.maskedPreview,
        });
      }
    }
  }

  return {
    sanitizedPatch,
    redactions,
  };
}

/**
 * Redacts secrets from a plain text block or commit message.
 */
export function redactText(text: string, findings: SecretFinding[]): string {
  if (!text || findings.length === 0) return text;

  const sortedFindings = [...findings].sort((a, b) => b.matchedText.length - a.matchedText.length);

  let result = text;
  for (const finding of sortedFindings) {
    if (!finding.matchedText) continue;
    result = result.replaceAll(finding.matchedText, finding.placeholder);
  }
  return result;
}

/**
 * Deeply sanitizes a ChangeContext by applying redaction to the raw unified diff.
 */
export function redactChangeContext(
  context: ChangeContext,
  findings: SecretFinding[],
): { sanitizedContext: ChangeContext; redactions: RedactionRecord[] } {
  const { sanitizedPatch, redactions } = redactPatch(context.patch, findings);

  const sanitizedContext: ChangeContext = {
    ...context,
    patch: sanitizedPatch,
  };

  return {
    sanitizedContext,
    redactions,
  };
}
