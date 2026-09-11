/**
 * Sanitizes untrusted strings (branch names, file paths, commit subjects, model output)
 * before terminal rendering to prevent terminal escape injection, OSC exploits,
 * and cursor/clipboard manipulation.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: Matches Operating System Command (OSC) escape sequences
const OSC_REGEX = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: Matches Control Sequence Introducer (CSI) / ANSI color & formatting escape codes
const CSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: Matches 2-character escape sequences (e.g. ESC M, ESC E)
const ESC_2CHAR_REGEX = /\x1b[@-Z\\-_]/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: Matches control characters except newline, carriage return, and tab
const DANGEROUS_CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Strips all ANSI, OSC, and non-printable control characters from a string.
 * Preserves normal newlines, tabs, and all valid Unicode characters.
 */
export function sanitizeTerminalString(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    return "";
  }

  return input
    .replace(OSC_REGEX, "")
    .replace(CSI_REGEX, "")
    .replace(ESC_2CHAR_REGEX, "")
    .replace(DANGEROUS_CONTROL_CHARS_REGEX, "");
}

/**
 * Truncates a string to maxLen with ellipsis if necessary, ensuring safety.
 */
export function truncateSafe(input: string, maxLen: number): string {
  const sanitized = sanitizeTerminalString(input);
  if (sanitized.length <= maxLen) return sanitized;
  return `${sanitized.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * Wraps text to fit within a specified terminal column width.
 */
export function wrapText(text: string, width: number): string[] {
  const sanitized = sanitizeTerminalString(text);
  const lines: string[] = [];
  const rawParagraphs = sanitized.split(/\r?\n/);

  for (const para of rawParagraphs) {
    if (para.length <= width) {
      lines.push(para);
      continue;
    }

    const words = para.split(" ");
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= width) {
        currentLine += ` ${word}`;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}
