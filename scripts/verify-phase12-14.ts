import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createGitWhisper, getCommitTimeline } from "../packages/core/src/index.js";
import { MyIDEAdapter } from "../packages/editor/src/index.js";
import { runGit } from "../packages/git/src/index.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), "apps/cli/dist/index.js");

async function runVerification() {
  console.log("=== Starting GitWhisper Phases 12–14 End-to-End Verification ===\n");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-verify-12-14-"));

  try {
    // 1. Setup sandbox repo
    await runGit(["init", "-b", "main"], { cwd: tmpDir });
    await runGit(["config", "user.name", "Verification Agent"], { cwd: tmpDir });
    await runGit(["config", "user.email", "verify@ritualdev.local"], { cwd: tmpDir });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: tmpDir });

    console.log("✓ Step 1: Initialized sandbox Git repository at", tmpDir);

    // 2. Test Phase 12 Reusable Core SDK
    const client = await createGitWhisper({ repository: tmpDir });
    console.log("✓ Step 2: Initialized createGitWhisper Core SDK client");

    const status = await client.getRepositoryStatus();
    if (status.hasStagedChanges !== false) throw new Error("Expected 0 staged changes");

    // Stage changes
    const testFilePath = path.join(tmpDir, "src", "auth.ts");
    await fs.mkdir(path.dirname(testFilePath), { recursive: true });
    await fs.writeFile(
      testFilePath,
      "export const login = (token: string) => Boolean(token);\n",
      "utf8",
    );
    await runGit(["add", "src/auth.ts"], { cwd: tmpDir });

    // Verify event emission
    const events: string[] = [];
    client.on("analysis:start", () => events.push("analysis:start"));
    client.on("analysis:complete", () => events.push("analysis:complete"));
    client.on("commit:start", () => events.push("commit:start"));
    client.on("commit:complete", () => events.push("commit:complete"));

    const genResult = await client.generateCommit();
    console.log(
      "✓ Step 3: Generated commit proposal & variants via Headless SDK:",
      genResult.proposal.description,
    );
    if (!events.includes("analysis:start") || !events.includes("analysis:complete")) {
      throw new Error("Missing analysis lifecycle events");
    }

    // Verify commit execution
    const commitResult = await client.commit("feat(auth): add token authentication login helper");
    console.log("✓ Step 4: Committed via SDK:", commitResult.hash);
    if (!events.includes("commit:start") || !events.includes("commit:complete")) {
      throw new Error("Missing commit lifecycle events");
    }

    // 3. Test Phase 13 Editor + MyIDE Integration
    const adapter = new MyIDEAdapter({
      repositoryRoot: tmpDir,
      editorName: "MyIDE-Test",
      activeFilePath: "src/auth.ts",
    });

    // Stage new file
    const billingPath = path.join(tmpDir, "src", "billing.ts");
    await fs.writeFile(billingPath, "export const processInvoice = () => true;\n", "utf8");
    await runGit(["add", "src/billing.ts"], { cwd: tmpDir });

    const explainRes = await adapter.explainCommit();
    if (!explainRes.success) throw new Error(`explainCommit failed: ${explainRes.error?.message}`);
    console.log(
      "✓ Step 5: MyIDEAdapter explainCommit successful. Reasons count:",
      explainRes.data?.reasons.length,
    );

    // Verify developer confirmation invariant
    const unconfirmedRes = await adapter.executeApprovedCommit(
      "feat(billing): add processInvoice service",
      { confirmed: false },
    );
    if (unconfirmedRes.success || unconfirmedRes.error?.code !== "CONFIRMATION_REQUIRED") {
      throw new Error("Approval invariant violated! Adapter must require confirmed: true");
    }
    console.log(
      "✓ Step 6: MyIDEAdapter approval invariant strictly verified (rejected unconfirmed commit)",
    );

    const confirmedRes = await adapter.executeApprovedCommit(
      "feat(billing): add processInvoice service",
      { confirmed: true },
    );
    if (!confirmedRes.success)
      throw new Error(`executeApprovedCommit failed: ${confirmedRes.error?.message}`);
    console.log("✓ Step 7: MyIDEAdapter executed approved commit:", confirmedRes.data?.hash);

    // 4. Test Phase 14 Commit Timeline & Workstream Intelligence
    // Add work-item commit
    const itemPath = path.join(tmpDir, "src", "item.ts");
    await fs.writeFile(itemPath, "export const item = 'DEV-142';\n", "utf8");
    await runGit(["add", "src/item.ts"], { cwd: tmpDir });
    await runGit(["commit", "-m", "fix(auth): refresh session tokens (DEV-142)"], { cwd: tmpDir });

    const timeline = await getCommitTimeline(tmpDir);
    console.log(
      `✓ Step 8: getCommitTimeline analyzed ${timeline.summary.totalCommits} commits into ${timeline.summary.workstreamCount} workstreams`,
    );
    const dev142 = timeline.workstreams.find((w) => w.workItems.includes("DEV-142"));
    if (!dev142) throw new Error("Failed to link DEV-142 work-item in timeline workstream");
    console.log(
      "✓ Step 9: Successfully clustered workstream by work-item DEV-142 with high confidence",
    );

    // 5. Test CLI command `gitwhisper timeline`
    const { stdout: cliOut } = await execFileAsync("node", [cliPath, "timeline", "--json"], {
      cwd: tmpDir,
    });
    const cliJson = JSON.parse(cliOut);
    if (!cliJson.workstreams || cliJson.workstreams.length === 0) {
      throw new Error("CLI timeline --json produced invalid output");
    }
    console.log(
      "✓ Step 10: `gitwhisper timeline --json` successfully executed and produced valid output",
    );

    console.log("\n=== ALL PHASES 12–14 VERIFICATIONS PASSED SUCCESSFULLY ===");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
