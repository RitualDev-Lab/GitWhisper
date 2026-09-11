import type { FilePatch, GitPatch, PatchHunk } from "./types.js";

/**
 * Builds a valid Git unified diff string for a single hunk.
 */
function formatHunk(hunk: PatchHunk): string {
  const oldLenStr = hunk.oldCount !== 1 ? `,${hunk.oldCount}` : "";
  const newLenStr = hunk.newCount !== 1 ? `,${hunk.newCount}` : "";
  const headerSuffix = hunk.header ? ` ${hunk.header}` : "";
  const hunkHeader = `@@ -${hunk.oldStart}${oldLenStr} +${hunk.newStart}${newLenStr} @@${headerSuffix}\n`;

  const linesText = hunk.lines.map((l) => l.rawLine).join("\n");
  return `${hunkHeader}${linesText}\n`;
}

/**
 * Builds standard file header lines for a patch.
 */
function formatFileHeader(file: FilePatch, hasAllHunks: boolean): string {
  const oldP = file.oldPath || file.newPath || "unknown";
  const newP = file.newPath || file.oldPath || "unknown";

  // Use clean forward-slash paths
  const oldPathFormatted = oldP === "/dev/null" ? "/dev/null" : `a/${oldP}`;
  const newPathFormatted = newP === "/dev/null" ? "/dev/null" : `b/${newP}`;

  const headerLines: string[] = [`diff --git a/${oldP} b/${newP}`];

  if (file.oldMode && file.newMode && file.oldMode !== file.newMode) {
    headerLines.push(`old mode ${file.oldMode}`);
    headerLines.push(`new mode ${file.newMode}`);
  } else if (file.status === "added" && hasAllHunks) {
    if (file.newMode) headerLines.push(`new file mode ${file.newMode}`);
  } else if (file.status === "deleted" && hasAllHunks) {
    if (file.oldMode) headerLines.push(`deleted file mode ${file.oldMode}`);
  }

  headerLines.push(`--- ${oldPathFormatted}`);
  headerLines.push(`+++ ${newPathFormatted}`);
  return `${headerLines.join("\n")}\n`;
}

/**
 * Builds a clean, valid unified patch containing only the specified hunk IDs.
 */
export function buildPatchSelection(sourcePatch: GitPatch, selectedHunkIds: string[]): string {
  const selectedSet = new Set(selectedHunkIds);
  const patchChunks: string[] = [];

  for (const file of sourcePatch.files) {
    // If binary, can only include if all hunks or whole file requested
    if (file.binary) {
      continue;
    }

    const matchingHunks = file.hunks.filter((h) => selectedSet.has(h.id));
    if (matchingHunks.length === 0) {
      continue;
    }

    const hasAllHunks = matchingHunks.length === file.hunks.length;
    const fileHeader = formatFileHeader(file, hasAllHunks);
    const hunksText = matchingHunks.map(formatHunk).join("");

    patchChunks.push(`${fileHeader}${hunksText}`);
  }

  return patchChunks.join("");
}

/**
 * Builds a patch containing all hunks EXCEPT the committed ones.
 */
export function buildRemainingPatch(sourcePatch: GitPatch, committedHunkIds: string[]): string {
  const committedSet = new Set(committedHunkIds);
  const remainingIds: string[] = [];

  for (const file of sourcePatch.files) {
    for (const hunk of file.hunks) {
      if (!committedSet.has(hunk.id)) {
        remainingIds.push(hunk.id);
      }
    }
  }

  return buildPatchSelection(sourcePatch, remainingIds);
}
