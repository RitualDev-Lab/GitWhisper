import { sanitizeTerminalString, truncateSafe } from "../composer/sanitizer.js";
import { redactText } from "../privacy/redactor.js";
import { scanSensitiveContent } from "../privacy/scanner.js";
import type { PrivacyConfigOptions } from "../privacy/types.js";
import type { WorkItem } from "./types.js";

export interface WorkItemGenerationContext {
  reference?: string;
  title?: string;
  relevantSummary?: string;
  referenceStyle?: string;
}

const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 500;

/**
 * Strips HTML tags and excessive whitespace from external issue text.
 */
export function cleanIssueText(text: string): string {
  let cleaned = sanitizeTerminalString(text);
  // Strip HTML tags like <div>, <p>, etc.
  cleaned = cleaned.replace(/<[^>]*>/g, " ");
  // Strip markdown image links ![alt](url)
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}

/**
 * Sanitizes a WorkItem for AI prompt consumption:
 * 1. Bounds title and description lengths (data minimization)
 * 2. Excludes author, comments, and attachments
 * 3. Runs Phase 7 secret scanning and redaction
 * 4. Returns clean, provider-safe WorkItemGenerationContext
 */
export async function sanitizeWorkItemForAI(
  workItem: WorkItem,
  privacyConfig?: Partial<PrivacyConfigOptions>,
): Promise<WorkItemGenerationContext> {
  const reference = workItem.key;

  // 1. Sanitize and bound title
  let title = workItem.title ? cleanIssueText(workItem.title) : undefined;
  if (title) {
    title = truncateSafe(title, MAX_TITLE_CHARS);
  }

  // 2. Sanitize and bound description
  let summary = workItem.description ? cleanIssueText(workItem.description) : undefined;
  if (summary) {
    summary = truncateSafe(summary, MAX_DESCRIPTION_CHARS);
  }

  // 3. Scan & redact sensitive values from title and description
  if (title) {
    const titleScan = await scanSensitiveContent({ text: title }, { config: privacyConfig });
    if (titleScan.findings.length > 0) {
      title = redactText(title, titleScan.findings);
    }
  }

  if (summary) {
    const summaryScan = await scanSensitiveContent({ text: summary }, { config: privacyConfig });
    if (summaryScan.findings.length > 0) {
      summary = redactText(summary, summaryScan.findings);
    }
  }

  return {
    reference,
    title,
    relevantSummary: summary,
  };
}
