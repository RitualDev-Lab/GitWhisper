export * from "./types.js";
export * from "./extractor.js";
export * from "./clustering.js";

import type { CommitTimeline, TimelineOptions } from "./types.js";
import { extractTimelineCommits } from "./extractor.js";
import { clusterCommitsIntoWorkstreams } from "./clustering.js";

/**
 * Analyzes repository commit history and groups commits into logical workstreams.
 * Strictly analytical, local-only, read-only.
 */
export async function getCommitTimeline(
  repoRoot: string,
  options: TimelineOptions = {},
): Promise<CommitTimeline> {
  const commits = await extractTimelineCommits(repoRoot, options);
  return clusterCommitsIntoWorkstreams(commits, options);
}
