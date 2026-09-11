import type { ClassifiedFileChange, DiffGuardOptions, DiffMetadata } from "./types.js";

export const DEFAULT_MAX_SAFE_BYTES = 32 * 1024; // 32 KB
export const DEFAULT_HARD_LIMIT_BYTES = 250 * 1024; // 250 KB

export class DiffTooLargeError extends Error {
  readonly diffBytes: number;
  readonly limitBytes: number;

  constructor(diffBytes: number, limitBytes: number) {
    const diffKb = Math.round(diffBytes / 1024);
    const limitKb = Math.round(limitBytes / 1024);
    super(
      `Staged diff is too large to analyze safely (${diffKb} KB exceeds ${limitKb} KB limit).\nPlease split your changes into smaller commits with \`git reset\` and \`git add\`.`,
    );
    this.name = "DiffTooLargeError";
    this.diffBytes = diffBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Sanitizes and enforces safety limits on git diffs before passing to AI models.
 * Binary changes are represented as metadata headers only.
 * Large diffs are deterministically truncated with metadata recorded.
 * Excessively large diffs trigger DiffTooLargeError.
 */
export function guardDiff(
  rawDiff: string,
  files: ClassifiedFileChange[],
  options: DiffGuardOptions = {},
): { sanitizedPatch: string; metadata: DiffMetadata } {
  const maxSafeBytes = options.maxSafeBytes ?? DEFAULT_MAX_SAFE_BYTES;
  const hardLimitBytes = options.hardLimitBytes ?? DEFAULT_HARD_LIMIT_BYTES;

  // Build binary file metadata headers to guarantee zero binary bytes reach LLMs
  const binaryHeaders: string[] = [];
  for (const file of files) {
    if (file.binary || file.category === "binary") {
      binaryHeaders.push(`Binary file ${file.status}: ${file.path}`);
    }
  }

  const binaryPrefix = binaryHeaders.length > 0 ? `${binaryHeaders.join("\n")}\n\n` : "";
  const combinedPatch = binaryPrefix + rawDiff;
  const originalBytes = Buffer.byteLength(combinedPatch, "utf8");

  if (originalBytes > hardLimitBytes) {
    throw new DiffTooLargeError(originalBytes, hardLimitBytes);
  }

  if (originalBytes <= maxSafeBytes) {
    return {
      sanitizedPatch: combinedPatch,
      metadata: {
        originalBytes,
        includedBytes: originalBytes,
        truncated: false,
      },
    };
  }

  // Deterministically truncate to maxSafeBytes, finding last newline boundary
  const buffer = Buffer.from(combinedPatch, "utf8");
  const sliceTarget = buffer.subarray(0, maxSafeBytes);
  const rawTruncated = sliceTarget.toString("utf8");

  const lastNewline = rawTruncated.lastIndexOf("\n");
  const cleanTruncated = lastNewline > 0 ? rawTruncated.substring(0, lastNewline) : rawTruncated;

  const includedBytes = Buffer.byteLength(cleanTruncated, "utf8");
  const omittedBytes = originalBytes - includedBytes;

  const warning = `Staged diff (${Math.round(originalBytes / 1024)} KB) was truncated to ${Math.round(
    includedBytes / 1024,
  )} KB for AI context safety.`;

  const finalPatch = `${cleanTruncated}\n\n[... Diff truncated: ${omittedBytes} bytes omitted for model safety ...]\n`;

  return {
    sanitizedPatch: finalPatch,
    metadata: {
      originalBytes,
      includedBytes,
      truncated: true,
      warning,
    },
  };
}
