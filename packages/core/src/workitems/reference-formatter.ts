import type { IssuePlacement, IssueReferencePolicy } from "./types.js";

/**
 * Formats an issue reference according to the configured policy.
 * Default is conservative "Refs <id>" (never "Fixes" without explicit approval).
 */
export function formatReferenceTrailer(key: string, policy?: IssueReferencePolicy): string {
  if (policy?.mode === "none") {
    return "";
  }

  if (policy?.mode === "close") {
    const keyword = policy.closingKeyword ?? "Fixes";
    return `${keyword} ${key}`;
  }

  const keyword = policy?.referenceKeyword ?? "Refs";
  return `${keyword} ${key}`;
}

/**
 * Checks whether the commit message already contains the issue reference key.
 */
export function containsReference(message: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escaped}(?:$|[^a-zA-Z0-9_-])`, "i");
  return regex.test(message);
}

/**
 * Safely inserts the formatted reference into the commit message, respecting placement
 * and preventing duplicate references.
 */
export function insertReferenceIntoMessage(
  message: string,
  key: string,
  policy?: IssueReferencePolicy,
  placement: IssuePlacement = "footer",
): string {
  if (!key || policy?.mode === "none") {
    return message;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return message;
  }

  // Duplicate reference prevention: if reference already exists, don't duplicate
  if (containsReference(trimmed, key)) {
    return trimmed;
  }

  const trailer = formatReferenceTrailer(key, policy);
  if (!trailer) {
    return trimmed;
  }

  if (placement === "subject") {
    // Subject prefix style: e.g. DEV-142 feat(auth): update session
    return `${key} ${trimmed}`;
  }

  // Footer placement (default & auto)
  // Ensure a clean blank line before the trailer
  return `${trimmed}\n\n${trailer}`;
}
