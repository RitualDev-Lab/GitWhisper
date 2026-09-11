export type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "unknown";

export interface GitFileChange {
  path: string;
  previousPath?: string;
  status: GitFileStatus;
  additions?: number;
  deletions?: number;
  binary: boolean;
}

export interface GitRemote {
  name: string;
  url: string;
  host?: string;
  owner?: string;
  repository?: string;
  provider?: "github" | "gitlab" | "bitbucket" | "generic";
}

export interface GitRepository {
  root: string;
  name: string;
  branch: string | null;
  head: string | null;
  isInitial: boolean;
  isDetachedHead?: boolean;
  remotes?: GitRemote[];
}

export interface GitRunOptions {
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitCommitResult {
  commitHash: string;
  fullOutput: string;
}

export interface GitCommitRecord {
  hash: string;
  parents: string[];
  authorDate?: string;
  subject: string;
  body?: string;
  refs?: string[];
  files?: string[];
}

export interface CommitHistoryOptions {
  limit?: number;
  includeMerges?: boolean;
  firstParent?: boolean;
  since?: string;
  withFiles?: boolean;
}

export interface GitIndexEntry {
  mode: string;
  hash: string;
  stage: number;
  path: string;
}

export interface CommitPlanExecutionResult {
  successfulCommits: Array<{ id: string; hash: string; subject: string }>;
  failedCommit?: { id: string; error: string };
  aborted: boolean;
  remainingFiles: string[];
}

export interface GitStateSnapshot {
  head: string;
  indexFingerprint: string;
  untrackedPaths: string[];
  workingTreeFileHashes: Record<string, string>;
}

export interface CommitDetails {
  record: GitCommitRecord;
  message: string;
  subject: string;
  body: string;
  changedFiles: GitFileChange[];
  patch: string;
}

export interface HookStatus {
  hookName: string;
  installed: boolean;
  isGitWhisperManaged: boolean;
  managedByGitWhisper: boolean;
  isExecutable?: boolean;
  isChained?: boolean;
  hookPath: string;
}
