import readline from "node:readline";
import type { IssueReferencePolicy, WorkItem, WorkItemReference } from "@gitwhisper/core";
import { formatReferenceTrailer } from "@gitwhisper/core";
import { colors } from "./terminal.js";

export interface WorkItemReviewResult {
  reference?: WorkItemReference;
  policy: IssueReferencePolicy;
  remove: boolean;
}

export async function promptWorkItemReview(
  currentReference: WorkItemReference | undefined,
  workItem: WorkItem | undefined,
  currentPolicy: IssueReferencePolicy,
  relevance = "unknown",
): Promise<WorkItemReviewResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  let ref = currentReference;
  const policy = { ...currentPolicy };

  try {
    while (true) {
      console.log(`\n--- ${colors.bold}Work Item & Reference Intent${colors.reset} ---`);
      if (ref) {
        console.log(
          ` ${colors.dim}Reference Key:${colors.reset}   ${colors.cyan}${ref.key}${colors.reset}`,
        );
        console.log(` ${colors.dim}Source:${colors.reset}          ${ref.source}`);
        if (workItem?.title) {
          console.log(` ${colors.dim}Title:${colors.reset}           ${workItem.title}`);
        }
        if (workItem?.state) {
          console.log(` ${colors.dim}State:${colors.reset}           ${workItem.state}`);
        }
        console.log(` ${colors.dim}Relevance:${colors.reset}       ${relevance}`);
        console.log(
          ` ${colors.dim}Commit Trailer:${colors.reset}  ${colors.green}${formatReferenceTrailer(ref.key, policy)}${colors.reset}`,
        );
      } else {
        console.log(` ${colors.yellow}No work-item reference currently attached.${colors.reset}`);
      }

      console.log(`
     ${colors.bold}[c]${colors.reset} Change reference key
     ${colors.bold}[r]${colors.reset} Remove reference from commit
     ${colors.bold}[m]${colors.reset} Toggle reference mode (${policy.mode === "close" ? "Fixes" : "Refs"})
     ${colors.bold}[b]${colors.reset} Back to composer
`);

      const answer = (await question(" Select action [c/r/m/b] (default: b): "))
        .trim()
        .toLowerCase();

      if (answer === "" || answer === "b" || answer === "back") {
        return { reference: ref, policy, remove: false };
      }

      if (answer === "r" || answer === "remove") {
        return { reference: undefined, policy: { ...policy, mode: "none" }, remove: true };
      }

      if (answer === "m" || answer === "mode") {
        if (policy.mode === "close") {
          policy.mode = "reference";
          console.log(` Mode set to standard reference (${policy.referenceKeyword ?? "Refs"}).`);
        } else {
          policy.mode = "close";
          console.log(` Mode set to closing reference (${policy.closingKeyword ?? "Fixes"}).`);
        }
        continue;
      }

      if (answer === "c" || answer === "change") {
        const newKey = (await question(" Enter work-item key (e.g. DEV-142, #123): ")).trim();
        if (newKey) {
          ref = {
            raw: newKey,
            key: newKey,
            source: "user",
            confidence: "high",
          };
          policy.mode = policy.mode === "none" ? "reference" : policy.mode;
        }
        continue;
      }

      console.log(" Invalid choice. Please select 'c', 'r', 'm', or 'b'.");
    }
  } finally {
    rl.close();
  }
}
