import { sanitizeTerminalString } from "../composer/sanitizer.js";
import type { ParsedCommit, ParsedCommitTrailer } from "./types.js";

// Conventional commit regex: type(scope)!: description or type!: description
const CONVENTIONAL_REGEX = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

// Trailer regex: e.g. "Refs DEV-142", "Fixes #123", "Signed-off-by: Alice <...>"
const TRAILER_STANDARD_REGEX = /^([a-zA-Z0-9_-]+):\s*(.+)$/;
const TRAILER_KEYWORD_REGEX = /^(Refs|Fixes|Closes|Resolves)\s+([^\n]+)$/i;

/**
 * Parses a raw commit message string into structured components.
 * Strips git comment lines (#), handles CRLF/LF, and extracts Conventional elements and trailers.
 */
export function parseCommitMessage(rawMessage: string): ParsedCommit {
  const sanitized = sanitizeTerminalString(rawMessage || "");

  // Split into lines and strip git comments (#)
  const lines = sanitized
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));

  // Find subject (first non-empty line)
  let subjectIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      subjectIndex = i;
      break;
    }
  }

  if (subjectIndex === -1) {
    return {
      raw: rawMessage,
      subject: "",
      breaking: false,
      description: "",
      trailers: [],
      isConventional: false,
    };
  }

  const subject = lines[subjectIndex].trim();
  const bodyLines = lines.slice(subjectIndex + 1);
  const rawBody = bodyLines.join("\n").trim();
  const body = rawBody.length > 0 ? rawBody : undefined;

  // Check conventional commit pattern on subject
  const convMatch = subject.match(CONVENTIONAL_REGEX);
  let type: string | undefined;
  let scope: string | undefined;
  let breaking = false;
  let description = subject;
  let isConventional = false;

  if (convMatch) {
    isConventional = true;
    type = convMatch[1]?.toLowerCase();
    scope = convMatch[2]?.trim();
    if (scope && scope.toLowerCase() === "none") {
      scope = undefined;
    }
    breaking = Boolean(convMatch[3]);
    description = convMatch[4]?.trim() || "";
  }

  // Check breaking change in body
  if (body && (body.includes("BREAKING CHANGE:") || body.includes("BREAKING-CHANGE:"))) {
    breaking = true;
  }

  // Parse trailers from the bottom of body
  const trailers: ParsedCommitTrailer[] = [];
  if (body) {
    const trimmedBodyLines = bodyLines.map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of trimmedBodyLines) {
      const kwMatch = line.match(TRAILER_KEYWORD_REGEX);
      if (kwMatch) {
        trailers.push({
          token: kwMatch[1],
          value: kwMatch[2].trim(),
          raw: line,
        });
        continue;
      }
      const stdMatch = line.match(TRAILER_STANDARD_REGEX);
      if (stdMatch) {
        trailers.push({
          token: stdMatch[1],
          value: stdMatch[2].trim(),
          raw: line,
        });
      }
    }
  }

  return {
    raw: rawMessage,
    subject,
    body,
    type,
    scope,
    breaking,
    description,
    trailers,
    isConventional,
  };
}
