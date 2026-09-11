import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createGitWhisper, getCommitTimeline } from "../packages/core/src/index.js";
import { MyIDEAdapter } from "../packages/editor/src/index.js";
import { runGit } from "../packages/git/src/index.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

interface SuiteStep {
  name: string;
  fn: () => Promise<void>;
}

async function runQualitySuite() {
  console.log("=========================================================");
  console.log("   GitWhisper Automated Quality Suite (QS) Runner       ");
  console.log("=========================================================\n");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-qs-test-"));
  let passedCount = 0;
  let failedCount = 0;

  try {
    // 1. Setup disposable sandbox repository
    await runGit(["init", "-b", "main"], { cwd: tmpDir });
    await runGit(["config", "user.name", "QS Automated Tester"], { cwd: tmpDir });
    await runGit(["config", "user.email", "qs@gitwhisper.local"], { cwd: tmpDir });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: tmpDir });

    const steps: SuiteStep[] = [
      {
        name: "CLI: --version and --help output",
        fn: async () => {
          const v = await execFileAsync("node", [cliEntry, "--version"], { cwd: tmpDir });
          if (!v.stdout.includes("gitwhisper v")) throw new Error("Missing version header");

          const h = await execFileAsync("node", [cliEntry, "--help"], { cwd: tmpDir });
          if (!h.stdout.includes("Commands:")) throw new Error("Missing commands in help output");
        },
      },
      {
        name: "CLI: gitwhisper style on empty repo",
        fn: async () => {
          const { stdout } = await execFileAsync("node", [cliEntry, "style", "--json"], {
            cwd: tmpDir,
          });
          const parsed = JSON.parse(stdout);
          if (parsed.sampleSize !== 0) throw new Error("Expected 0 commits in empty repo");
        },
      },
      {
        name: "Core SDK: Headless initialization and repository status",
        fn: async () => {
          const client = await createGitWhisper({ repository: tmpDir });
          const status = await client.getRepositoryStatus();
          if (status.hasStagedChanges !== false)
            throw new Error("Expected hasStagedChanges: false");
          if (status.branch !== "main")
            throw new Error(`Expected main branch, got ${status.branch}`);
        },
      },
      {
        name: "Core SDK: Analysis and proposal generation without mutation",
        fn: async () => {
          const authFile = path.join(tmpDir, "src", "auth.ts");
          await fs.mkdir(path.dirname(authFile), { recursive: true });
          await fs.writeFile(
            authFile,
            "export const verifyToken = (t: string) => Boolean(t);\n",
            "utf8",
          );
          await runGit(["add", "src/auth.ts"], { cwd: tmpDir });

          const client = await createGitWhisper({ repository: tmpDir });
          const events: string[] = [];
          client.on("analysis:start", () => events.push("start"));
          client.on("analysis:complete", () => events.push("complete"));

          const result = await client.generateCommit();
          if (!result.proposal.description) throw new Error("Missing proposal description");
          if (result.variants.length !== 3) throw new Error("Expected 3 variants");
          if (!events.includes("start") || !events.includes("complete")) {
            throw new Error("Missing analysis lifecycle events");
          }

          // Verify 0 commits were made
          const log = await runGit(["rev-parse", "HEAD"], { cwd: tmpDir }).catch(() => null);
          if (log !== null) throw new Error("Analysis mutated repository before commit approval!");
        },
      },
      {
        name: "CLI: gitwhisper check validates commit messages and staged evidence",
        fn: async () => {
          // Valid conventional commit
          const valid = await execFileAsync(
            "node",
            [cliEntry, "check", "feat(auth): verify authentication tokens", "--json"],
            { cwd: tmpDir },
          );
          const validJson = JSON.parse(valid.stdout);
          if (!validJson.valid) throw new Error("Expected valid commit message");

          // Vague message rejection
          try {
            await execFileAsync("node", [cliEntry, "check", "update stuff", "--strict", "--json"], {
              cwd: tmpDir,
            });
            throw new Error("Vague message should have failed strict check");
          } catch (err: any) {
            const errJson = JSON.parse(err.stdout || "{}");
            if (errJson.valid !== false) throw new Error("Expected valid: false for vague message");
          }
        },
      },
      {
        name: "Core SDK: Commit mutation and lifecycle event emission",
        fn: async () => {
          const client = await createGitWhisper({ repository: tmpDir });
          const commitEvents: string[] = [];
          client.on("commit:start", () => commitEvents.push("start"));
          client.on("commit:complete", () => commitEvents.push("complete"));

          const res = await client.commit("feat(auth): implement token verification helper");
          if (!res.hash || !res.message) throw new Error("Commit failed to return hash/message");
          if (!commitEvents.includes("start") || !commitEvents.includes("complete")) {
            throw new Error("Missing commit lifecycle events");
          }
        },
      },
      {
        name: "CLI: Git hook management (install -> status -> uninstall)",
        fn: async () => {
          try {
            // 1. Install with json flag
            const installOut = await execFileAsync(
              "node",
              [cliEntry, "hooks", "install", "--mode", "strict", "--json"],
              { cwd: tmpDir },
            );
            const installJson = JSON.parse(installOut.stdout);
            if (!installJson.installed) throw new Error("Install returned installed: false");
            if (installJson.mode !== "strict") throw new Error("Install mode not strict");

            // 2. Status check
            const statusOut = await execFileAsync("node", [cliEntry, "hooks", "status", "--json"], {
              cwd: tmpDir,
            });
            const statusJson = JSON.parse(statusOut.stdout);
            if (!statusJson.installed) throw new Error("Hook not reported installed in status");
            if (!statusJson.isGitWhisperManaged) throw new Error("Hook not managed by GitWhisper");
          } finally {
            // Guarantee uninstallation so subsequent steps aren't blocked
            await execFileAsync("node", [cliEntry, "hooks", "uninstall"], { cwd: tmpDir }).catch(
              () => {},
            );
          }

          // 3. Verify removal outside finally block
          const uninstalledOut = await execFileAsync(
            "node",
            [cliEntry, "hooks", "status", "--json"],
            { cwd: tmpDir },
          );
          const uninstalledJson = JSON.parse(uninstalledOut.stdout);
          if (uninstalledJson.installed) throw new Error("Hook was not cleanly removed");
        },
      },
      {
        name: "Editor Adapter: explainCommit decision provenance",
        fn: async () => {
          const adapter = new MyIDEAdapter({
            repositoryRoot: tmpDir,
            editorName: "QS-MyIDE",
          });

          // Stage a change
          await fs.writeFile(
            path.join(tmpDir, "src", "billing.ts"),
            "export const invoice = true;\n",
            "utf8",
          );
          await runGit(["add", "src/billing.ts"], { cwd: tmpDir });

          const explanation = await adapter.explainCommit();
          if (!explanation.success || !explanation.data) throw new Error("explainCommit failed");
          if (explanation.data.filesCount !== 1) throw new Error("Expected 1 staged file");
          if (!explanation.data.privacyBadge) throw new Error("Missing privacy badge");
          if (explanation.data.reasons.length === 0)
            throw new Error("Expected non-empty reasons list");
        },
      },
      {
        name: "Editor Adapter: Developer confirmation invariant strictly blocks unconfirmed commits",
        fn: async () => {
          const adapter = new MyIDEAdapter({
            repositoryRoot: tmpDir,
            editorName: "QS-MyIDE",
          });

          // Attempt commit with confirmed: false
          const unconfirmed = await adapter.executeApprovedCommit(
            "feat(billing): add invoicing support",
            { confirmed: false },
          );
          if (unconfirmed.success)
            throw new Error("Invariant violated: Unconfirmed commit succeeded!");
          if (unconfirmed.error?.code !== "CONFIRMATION_REQUIRED") {
            throw new Error(`Expected CONFIRMATION_REQUIRED, got: ${unconfirmed.error?.code}`);
          }

          // Execute commit with confirmed: true
          const confirmed = await adapter.executeApprovedCommit(
            "feat(billing): add invoicing support",
            { confirmed: true },
          );
          if (!confirmed.success || !confirmed.data?.hash) {
            throw new Error("Approved commit failed with confirmed: true");
          }
        },
      },
      {
        name: "Phase 14 Timeline: Historical workstream clustering with issue keys and reverts",
        fn: async () => {
          // Commit with ticket DEV-142
          await fs.writeFile(
            path.join(tmpDir, "src", "feature.ts"),
            "export const dev142 = true;\n",
            "utf8",
          );
          await runGit(["add", "src/feature.ts"], { cwd: tmpDir });
          await runGit(["commit", "-m", "feat(auth): refresh user sessions (DEV-142)"], {
            cwd: tmpDir,
          });

          // Revert commit
          const faultyHash = (await runGit(["rev-parse", "HEAD"], { cwd: tmpDir })).stdout.trim();
          await runGit(["revert", "--no-edit", faultyHash], { cwd: tmpDir });

          const timeline = await getCommitTimeline(tmpDir);
          if (timeline.summary.totalCommits < 4)
            throw new Error("Expected at least 4 commits in timeline");
          if (timeline.workstreams.length === 0) throw new Error("No workstreams clustered");

          const revertCommit = timeline.commits.find((c) => c.isRevert);
          if (!revertCommit) throw new Error("Revert commit not detected");
          if (revertCommit.revertsHash?.slice(0, 7) !== faultyHash.slice(0, 7)) {
            throw new Error("Revert commit did not link to original hash");
          }

          // CLI timeline command test
          const { stdout } = await execFileAsync("node", [cliEntry, "timeline", "--json"], {
            cwd: tmpDir,
          });
          const cliParsed = JSON.parse(stdout);
          if (!cliParsed.workstreams || cliParsed.workstreams.length === 0) {
            throw new Error("CLI timeline failed to return workstreams");
          }
        },
      },
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      process.stdout.write(` [${i + 1}/${steps.length}] Running: ${step.name}... `);
      try {
        await step.fn();
        console.log("PASS ✓");
        passedCount++;
      } catch (err: any) {
        console.log("FAIL ✗");
        console.error(`       Error: ${err.message}`);
        failedCount++;
      }
    }

    console.log("\n=========================================================");
    console.log(`   Quality Suite Completed: ${passedCount} Passed, ${failedCount} Failed`);
    console.log("=========================================================\n");

    if (failedCount > 0) {
      process.exit(1);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

runQualitySuite().catch((err) => {
  console.error("Fatal error in Quality Suite:", err);
  process.exit(1);
});
