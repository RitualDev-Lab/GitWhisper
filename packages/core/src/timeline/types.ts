export interface TimelineCommit {
  hash: string;
  shortHash: string;
  subject: string;
  body?: string;
  author: {
    name?: string;
    email?: string;
    date?: string;
  };
  type?: string;
  scope?: string;
  files: string[];
  workItems: string[];
  isRevert: boolean;
  revertsHash?: string;
  isMerge: boolean;
}

export interface Workstream {
  id: string;
  name: string;
  theme: string;
  scope?: string;
  workItems: string[];
  commits: TimelineCommit[];
  sharedFiles: string[];
  confidence: "high" | "medium" | "low";
}

export interface CommitTimeline {
  commits: TimelineCommit[];
  workstreams: Workstream[];
  summary: {
    totalCommits: number;
    workstreamCount: number;
    timespan: {
      earliest?: string;
      latest?: string;
    };
  };
}

export interface TimelineOptions {
  limit?: number;
  includeMerges?: boolean;
  scope?: string;
  signal?: AbortSignal;
}
