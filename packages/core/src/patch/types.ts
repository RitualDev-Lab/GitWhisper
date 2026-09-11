import type { GitFileStatus } from "@gitwhisper/git";

export type PatchLineKind = "context" | "addition" | "deletion" | "metadata";

export interface PatchLine {
  kind: PatchLineKind;
  content: string;
  rawLine: string;
  oldLine?: number;
  newLine?: number;
}

export interface PatchHunk {
  id: string;
  fileIndex: number;
  hunkIndex: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header?: string;
  lines: PatchLine[];
  fingerprint: string;
}

export interface FilePatch {
  fileIndex: number;
  oldPath?: string;
  newPath?: string;
  status: GitFileStatus;
  oldMode?: string;
  newMode?: string;
  hunks: PatchHunk[];
  binary: boolean;
  rawHeaderLines: string[];
}

export interface GitPatch {
  files: FilePatch[];
  rawText: string;
}
