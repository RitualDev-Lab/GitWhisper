import { getCommitHistory, isRevertCommit } from "@gitwhisper/git";
import { parseCommitMessage } from "../quality/parser.js";
import type { TimelineCommit, TimelineOptions } from "./types.js";

const ISSUE_REF_REGEX = /\b([A-Z][A-Z0-9]+-\d+|#\d+|GH-\d+)\b/g;

/**
 * Extracts and normalizes local commit history into structured TimelineCommit records.
 * 100% local, safe against prompt injection, zero network calls.
 */
export async function extractTimelineCommits(
  repoRoot: string,
  options: TimelineOptions = {},
): Promise<TimelineCommit[]> {
  const limit = options.limit ?? 50;
  const records = await getCommitHistory(repoRoot, {
    limit,
    withFiles: true,
    includeMerges: true,
  });

  const timelineCommits: TimelineCommit[] = [];

  for (const r of records) {
    if (options.signal?.aborted) {
      throw new Error("Operation aborted.");
    }

    const isMerge = r.parents.length > 1;
    if (!options.includeMerges && isMerge) {
      continue;
    }

    const parsed = parseCommitMessage(r.subject);
    const isRevert = isRevertCommit(r.subject);

    // Revert target detection: e.g. This reverts commit abc1234
    let revertsHash: string | undefined;
    if (isRevert && r.body) {
      const revertMatch = r.body.match(/This reverts commit ([a-f0-9]{7,40})/i);
      if (revertMatch) {
        revertsHash = revertMatch[1];
      }
    }

    // Work items from subject, body, or trailers
    const workItemsSet = new Set<string>();
    const fullText = `${r.subject}\n${r.body || ""}`;
    const matches = fullText.match(ISSUE_REF_REGEX);
    if (matches) {
      for (const m of matches) {
        workItemsSet.add(m);
      }
    }

    const files = r.files || [];

    timelineCommits.push({
      hash: r.hash,
      shortHash: r.hash.slice(0, 7),
      subject: r.subject,
      body: r.body,
      author: {
        date: r.authorDate,
      },
      type: parsed.type,
      scope: parsed.scope,
      files,
      workItems: Array.from(workItemsSet),
      isRevert,
      revertsHash,
      isMerge,
    });
  }

  return timelineCommits;
}
