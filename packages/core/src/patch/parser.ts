import type { GitFileStatus } from "@gitwhisper/git";
import { computeHunkFingerprint } from "./fingerprint.js";
import type { FilePatch, GitPatch, PatchHunk, PatchLine } from "./types.js";

/**
 * Strips quotes and Git prefixes (a/, b/) from a path in a diff header.
 */
function cleanPath(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
    // Unescape common escapes
    cleaned = cleaned.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (cleaned === "/dev/null") {
    return "/dev/null";
  }
  if (cleaned.startsWith("a/") || cleaned.startsWith("b/")) {
    cleaned = cleaned.slice(2);
  }
  return cleaned;
}

/**
 * Extracts oldPath and newPath from `diff --git ...` line.
 */
function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } {
  const rest = line.slice("diff --git ".length).trim();
  // If no quotes, split on space
  if (!rest.includes('"')) {
    const parts = rest.split(" ");
    return {
      oldPath: cleanPath(parts[0] || ""),
      newPath: cleanPath(parts[1] || ""),
    };
  }

  // Handle quoted paths, e.g. "a/file name" "b/file name"
  const match = rest.match(/^(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))$/);
  if (match) {
    const oldP = match[1] ?? match[2] ?? "";
    const newP = match[3] ?? match[4] ?? "";
    return {
      oldPath: cleanPath(oldP),
      newPath: cleanPath(newP),
    };
  }

  // Fallback
  return { oldPath: "", newPath: "" };
}

/**
 * Parses raw unified diff text into a structured GitPatch model.
 */
export function parsePatch(rawText: string, indexFingerprint?: string): GitPatch {
  const lines = rawText.split(/\r?\n/);
  const files: FilePatch[] = [];

  let i = 0;
  let fileIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Find the beginning of a file diff
    if (!line.startsWith("diff --git ")) {
      i++;
      continue;
    }

    fileIndex++;
    const { oldPath, newPath } = parseDiffGitHeader(line);
    const rawHeaderLines: string[] = [line];
    i++;

    let status: GitFileStatus = "modified";
    let oldMode: string | undefined;
    let newMode: string | undefined;
    let actualOldPath = oldPath;
    let actualNewPath = newPath;
    let isBinary = false;

    // Parse extended file headers
    while (i < lines.length && !lines[i].startsWith("diff --git ") && !lines[i].startsWith("@@ ")) {
      const headerLine = lines[i];

      if (headerLine.startsWith("old mode ")) {
        oldMode = headerLine.slice("old mode ".length).trim();
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("new mode ")) {
        newMode = headerLine.slice("new mode ".length).trim();
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("new file mode ")) {
        status = "added";
        newMode = headerLine.slice("new file mode ".length).trim();
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("deleted file mode ")) {
        status = "deleted";
        oldMode = headerLine.slice("deleted file mode ".length).trim();
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("rename from ")) {
        status = "renamed";
        actualOldPath = cleanPath(headerLine.slice("rename from ".length));
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("rename to ")) {
        status = "renamed";
        actualNewPath = cleanPath(headerLine.slice("rename to ".length));
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("similarity index ")) {
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("index ")) {
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("--- ")) {
        const rawOld = headerLine.slice(4).trim();
        if (rawOld === "/dev/null") {
          status = "added";
        }
        rawHeaderLines.push(headerLine);
      } else if (headerLine.startsWith("+++ ")) {
        const rawNew = headerLine.slice(4).trim();
        if (rawNew === "/dev/null") {
          status = "deleted";
        }
        rawHeaderLines.push(headerLine);
      } else if (
        headerLine.startsWith("Binary files ") ||
        headerLine.includes("GIT binary patch")
      ) {
        isBinary = true;
        rawHeaderLines.push(headerLine);
      } else {
        rawHeaderLines.push(headerLine);
      }

      i++;
    }

    const hunks: PatchHunk[] = [];
    let hunkIndex = 0;

    // Parse hunks
    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      const hunkLine = lines[i];

      if (!hunkLine.startsWith("@@ ")) {
        i++;
        continue;
      }

      hunkIndex++;
      const hunkMatch = hunkLine.match(
        /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(?:[ \t]+(.*))?$/,
      );

      if (!hunkMatch) {
        i++;
        continue;
      }

      const oldStart = Number.parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] !== undefined ? Number.parseInt(hunkMatch[2], 10) : 1;
      const newStart = Number.parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] !== undefined ? Number.parseInt(hunkMatch[4], 10) : 1;
      const hunkHeader = hunkMatch[5]?.trim();

      i++;

      const hunkLines: PatchLine[] = [];
      let currentOld = oldStart;
      let currentNew = newStart;

      while (
        i < lines.length &&
        !lines[i].startsWith("@@ ") &&
        !lines[i].startsWith("diff --git ")
      ) {
        const curLine = lines[i];

        if (curLine.startsWith("+")) {
          hunkLines.push({
            kind: "addition",
            content: curLine.slice(1),
            rawLine: curLine,
            newLine: currentNew++,
          });
        } else if (curLine.startsWith("-")) {
          hunkLines.push({
            kind: "deletion",
            content: curLine.slice(1),
            rawLine: curLine,
            oldLine: currentOld++,
          });
        } else if (curLine.startsWith(" ")) {
          hunkLines.push({
            kind: "context",
            content: curLine.slice(1),
            rawLine: curLine,
            oldLine: currentOld++,
            newLine: currentNew++,
          });
        } else if (curLine.startsWith("\\")) {
          hunkLines.push({
            kind: "metadata",
            content: curLine,
            rawLine: curLine,
          });
        } else if (curLine === "") {
          const oldConsumed = oldStart === 0 && oldCount === 0 ? 0 : currentOld - oldStart;
          const newConsumed = newStart === 0 && newCount === 0 ? 0 : currentNew - newStart;
          if (oldConsumed >= oldCount && newConsumed >= newCount) {
            break;
          }
          // Empty line treated as empty context line if inside hunk
          hunkLines.push({
            kind: "context",
            content: "",
            rawLine: " ",
            oldLine: currentOld++,
            newLine: currentNew++,
          });
        } else {
          // Unknown or end of hunk
          break;
        }

        i++;
      }

      const hunkId = `f${fileIndex}:h${hunkIndex}`;
      const filePath = actualNewPath || actualOldPath;
      const fingerprint = computeHunkFingerprint(
        { oldStart, newStart, lines: hunkLines },
        filePath,
        indexFingerprint,
      );

      hunks.push({
        id: hunkId,
        fileIndex,
        hunkIndex,
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: hunkHeader,
        lines: hunkLines,
        fingerprint,
      });
    }

    files.push({
      fileIndex,
      oldPath: actualOldPath,
      newPath: actualNewPath,
      status,
      oldMode,
      newMode,
      hunks,
      binary: isBinary,
      rawHeaderLines,
    });
  }

  return {
    files,
    rawText,
  };
}
