import crypto from "node:crypto";
import type { PatchLine } from "./types.js";

/**
 * Computes a durable SHA-1 fingerprint for a hunk based on relative path,
 * line offsets, and normalized additions/deletions.
 */
export function computeHunkFingerprint(
  hunk: {
    oldStart: number;
    newStart: number;
    lines: PatchLine[];
  },
  filePath: string,
  indexFingerprint?: string,
): string {
  const hash = crypto.createHash("sha1");
  hash.update(filePath);
  if (indexFingerprint) {
    hash.update(indexFingerprint);
  }
  hash.update(`${hunk.oldStart}:${hunk.newStart}`);

  for (const line of hunk.lines) {
    if (line.kind === "addition" || line.kind === "deletion") {
      hash.update(`${line.kind}:${line.content.trim()}`);
    }
  }

  return hash.digest("hex");
}
