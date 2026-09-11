import crypto from "node:crypto";
import type { LineType } from "./types.js";

/**
 * Creates a safe masked preview of a secret for human review.
 * Never displays the entire secret.
 */
export function maskSecret(raw: string, category?: string): string {
  if (category === "private-key" || raw.includes("PRIVATE KEY")) {
    return "-----BEGIN [REDACTED PRIVATE KEY]-----";
  }

  const trimmed = raw.trim();
  if (trimmed.length <= 8) {
    return "********";
  }

  const prefix = trimmed.slice(0, Math.min(4, Math.floor(trimmed.length / 4)));
  const suffix = trimmed.slice(-Math.min(4, Math.floor(trimmed.length / 4)));
  return `${prefix}****${suffix}`;
}

/**
 * Computes a deterministic SHA-256 fingerprint of a secret string.
 */
export function computeFingerprint(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/**
 * Computes Shannon entropy of a string.
 */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const COMMON_PLACEHOLDERS = [
  /^example/i,
  /^dummy/i,
  /^test/i,
  /^your[_-]?(?:api[_-]?key|token|secret|password|key)?(?:[_-]?(?:here|go[_-]?here))?$/i,
  /^(?:insert|put)[_-]?(?:here|key|secret|token)?$/i,
  /^changeme/i,
  /^placeholder/i,
  /^todo/i,
  /^undefined$/i,
  /^null$/i,
  /^fake[_-]?/i,
  /^[xX*]+$/,
  /^[0-9]+$/,
  /^[a-zA-Z]$/,
  /^my[_-]?(?:secret|token|key|password)$/i,
];

/**
 * Returns true if a string is clearly an innocent placeholder.
 */
export function isPlaceholder(str: string): boolean {
  const trimmed = str.trim().replace(/^["'`]|["'`]$/g, "");
  if (trimmed.length < 4) return true;
  return COMMON_PLACEHOLDERS.some((re) => re.test(trimmed));
}

export interface ParsedDiffLine {
  filePath: string;
  line: string;
  lineNumber: number;
  lineType: LineType;
  content: string; // line without the leading + / - / ' '
}

/**
 * Parses a unified git diff into individual lines with accurate file path,
 * line number, and line type (added, deleted, or context).
 */
export function parseDiffLines(patch: string, defaultFilePath = "unknown"): ParsedDiffLine[] {
  const lines = patch.split("\n");
  const result: ParsedDiffLine[] = [];

  let currentFile = defaultFilePath;
  let currentOldLine = 0;
  let currentNewLine = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git a/")) {
      const parts = line.split(" ");
      if (parts.length >= 4) {
        currentFile = parts[3]?.replace(/^b\//, "") ?? defaultFilePath;
      }
      continue;
    }

    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }

    if (line.startsWith("--- a/")) {
      continue;
    }

    // Hunk header: @@ -oldStart,oldLen +newStart,newLen @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      currentOldLine = Number.parseInt(hunkMatch[1] ?? "1", 10);
      currentNewLine = Number.parseInt(hunkMatch[2] ?? "1", 10);
      continue;
    }

    if (line.startsWith("+")) {
      result.push({
        filePath: currentFile,
        line,
        lineNumber: currentNewLine,
        lineType: "added",
        content: line.slice(1),
      });
      currentNewLine++;
    } else if (line.startsWith("-")) {
      result.push({
        filePath: currentFile,
        line,
        lineNumber: currentOldLine,
        lineType: "deleted",
        content: line.slice(1),
      });
      currentOldLine++;
    } else if (line.startsWith(" ")) {
      result.push({
        filePath: currentFile,
        line,
        lineNumber: currentNewLine,
        lineType: "context",
        content: line.slice(1),
      });
      currentOldLine++;
      currentNewLine++;
    } else if (line.trim().length > 0) {
      // Fallback for raw text lines without leading unified diff symbols
      result.push({
        filePath: currentFile,
        line,
        lineNumber: currentNewLine || 1,
        lineType: "added",
        content: line,
      });
      currentNewLine++;
    }
  }

  return result;
}
