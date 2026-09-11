import type { CommitTimeline, TimelineCommit, TimelineOptions, Workstream } from "./types.js";

function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getCommonDirectory(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  const dirs = paths
    .map((p) => {
      const parts = p.replace(/\\/g, "/").split("/");
      return parts.length > 1 ? parts[0] : undefined;
    })
    .filter(Boolean) as string[];

  if (dirs.length === 0) return undefined;
  // Return most frequent top-level dir
  const counts = new Map<string, number>();
  for (const d of dirs) {
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let bestDir: string | undefined;
  let maxCount = 0;
  for (const [d, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      bestDir = d;
    }
  }
  return bestDir;
}

/**
 * Clusters timeline commits into coherent workstreams using deterministic signals:
 * work-items, conventional scopes, file overlap, reverts, and temporal proximity.
 */
export function clusterCommitsIntoWorkstreams(
  commits: TimelineCommit[],
  options: TimelineOptions = {},
): CommitTimeline {
  const filteredCommits = options.scope
    ? commits.filter((c) => c.scope?.toLowerCase() === options.scope?.toLowerCase())
    : commits;

  if (filteredCommits.length === 0) {
    return {
      commits: [],
      workstreams: [],
      summary: {
        totalCommits: 0,
        workstreamCount: 0,
        timespan: {},
      },
    };
  }

  const workstreams: Workstream[] = [];

  for (const commit of filteredCommits) {
    let matchedWs: Workstream | undefined;

    // 1. Check revert link
    if (commit.isRevert && commit.revertsHash) {
      matchedWs = workstreams.find((ws) =>
        ws.commits.some(
          (c) => c.hash.startsWith(commit.revertsHash!) || commit.revertsHash!.startsWith(c.hash),
        ),
      );
    }

    // 2. Check work-item link
    if (!matchedWs && commit.workItems.length > 0) {
      matchedWs = workstreams.find((ws) =>
        ws.workItems.some((wi) => commit.workItems.includes(wi)),
      );
    }

    // 3. Check scope link (if valid scope and temporally within 15 commits)
    if (!matchedWs && commit.scope) {
      matchedWs = workstreams.find((ws) => ws.scope?.toLowerCase() === commit.scope?.toLowerCase());
    }

    // 4. Check shared file overlap
    if (!matchedWs && commit.files.length > 0) {
      matchedWs = workstreams.find((ws) => {
        const wsFiles = new Set(ws.commits.flatMap((c) => c.files));
        return commit.files.some((f) => wsFiles.has(f));
      });
    }

    if (matchedWs) {
      matchedWs.commits.push(commit);
      for (const wi of commit.workItems) {
        if (!matchedWs.workItems.includes(wi)) {
          matchedWs.workItems.push(wi);
        }
      }
    } else {
      // Create new workstream
      const id = `ws-${workstreams.length + 1}`;
      let name: string;
      let theme: string;

      if (commit.workItems.length > 0) {
        const item = commit.workItems[0];
        const scopePart = commit.scope ? ` (${capitalize(commit.scope)})` : "";
        name = `${item}${scopePart}`;
        theme = `Work-Item ${item}`;
      } else if (commit.scope) {
        name = capitalize(commit.scope);
        theme = `${name} Development`;
      } else {
        const topDir = getCommonDirectory(commit.files);
        if (topDir) {
          name = capitalize(topDir);
          theme = `${name} Workstream`;
        } else {
          name = commit.subject.slice(0, 30);
          theme = "General Development";
        }
      }

      workstreams.push({
        id,
        name,
        theme,
        scope: commit.scope,
        workItems: [...commit.workItems],
        commits: [commit],
        sharedFiles: [],
        confidence: commit.workItems.length > 0 || commit.scope ? "high" : "medium",
      });
    }
  }

  // Calculate shared files and finalize confidence
  for (const ws of workstreams) {
    const fileFrequency = new Map<string, number>();
    for (const c of ws.commits) {
      for (const f of c.files) {
        fileFrequency.set(f, (fileFrequency.get(f) || 0) + 1);
      }
    }

    ws.sharedFiles = Array.from(fileFrequency.entries())
      .filter(([_, count]) => count > 1)
      .map(([file]) => file);

    if (ws.commits.length === 1 && ws.workItems.length === 0 && !ws.scope) {
      ws.confidence = "low";
    }
  }

  const earliest = filteredCommits[filteredCommits.length - 1]?.author.date;
  const latest = filteredCommits[0]?.author.date;

  return {
    commits: filteredCommits,
    workstreams,
    summary: {
      totalCommits: filteredCommits.length,
      workstreamCount: workstreams.length,
      timespan: {
        earliest,
        latest,
      },
    },
  };
}
