import { getCommitTimeline } from "@gitwhisper/core";
import { findRepository } from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface TimelineCommandOptions {
  limit?: number;
  scope?: string;
  details?: boolean;
  json?: boolean;
}

export async function runTimeline(options: TimelineCommandOptions = {}): Promise<void> {
  const repoRoot = await findRepository();
  if (!repoRoot) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "NOT_A_GIT_REPOSITORY",
              message: "Not inside a Git repository.",
            },
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    process.exit(1);
  }

  const limit = options.limit ? Number(options.limit) : 30;
  const timeline = await getCommitTimeline(repoRoot, {
    limit,
    scope: options.scope,
    includeMerges: false,
  });

  if (options.json) {
    console.log(JSON.stringify(timeline, null, 2));
    return;
  }

  printHeader();
  console.log(
    ` ${colors.bold}${colors.cyan}Commit Timeline & Repository History Intelligence${colors.reset}\n`,
  );

  const { totalCommits, workstreamCount, timespan } = timeline.summary;
  console.log(
    ` Analyzed ${colors.bold}${totalCommits}${colors.reset} commits across ${colors.bold}${workstreamCount}${colors.reset} workstreams.`,
  );
  if (timespan.earliest && timespan.latest) {
    console.log(
      ` Timespan: ${colors.dim}${timespan.earliest.slice(0, 10)} to ${timespan.latest.slice(0, 10)}${colors.reset}\n`,
    );
  } else {
    console.log("");
  }

  if (timeline.workstreams.length === 0) {
    console.log(` ${colors.dim}No commits found matching query.${colors.reset}\n`);
    return;
  }

  for (let i = 0; i < timeline.workstreams.length; i++) {
    const ws = timeline.workstreams[i];
    const confColor =
      ws.confidence === "high"
        ? colors.green
        : ws.confidence === "medium"
          ? colors.yellow
          : colors.dim;

    console.log(
      ` ${colors.bold}[${i + 1}/${timeline.workstreams.length}] ${ws.name}${colors.reset} ${confColor}(${ws.confidence} confidence)${colors.reset}`,
    );
    console.log(
      `   ${colors.dim}Theme: ${ws.theme} | Commits: ${ws.commits.length}${colors.reset}`,
    );

    if (ws.workItems.length > 0) {
      console.log(`   ${colors.cyan}Work-Items:${colors.reset} ${ws.workItems.join(", ")}`);
    }

    if (ws.sharedFiles.length > 0) {
      console.log(
        `   ${colors.dim}Shared Files (${ws.sharedFiles.length}): ${ws.sharedFiles.slice(0, 3).join(", ")}${ws.sharedFiles.length > 3 ? "..." : ""}${colors.reset}`,
      );
    }

    console.log("");
    for (const c of ws.commits) {
      const revertBadge = c.isRevert ? ` ${colors.red}[REVERT]${colors.reset}` : "";
      const hashStr = `${colors.yellow}${c.shortHash}${colors.reset}`;
      console.log(`     ${hashStr} ${c.subject}${revertBadge}`);

      if (options.details) {
        if (c.files.length > 0) {
          console.log(
            `       ${colors.dim}Files: ${c.files.slice(0, 4).join(", ")}${c.files.length > 4 ? ` (+${c.files.length - 4} more)` : ""}${colors.reset}`,
          );
        }
        if (c.revertsHash) {
          console.log(`       ${colors.red}Reverts: ${c.revertsHash.slice(0, 7)}${colors.reset}`);
        }
      }
    }
    console.log("");
  }
}
