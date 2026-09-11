#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  SecurityHostBindingError,
  assertCredentialHostBinding,
  evaluateIntentRelevance,
  formatReferenceTrailer,
  insertReferenceIntoMessage,
  parseBranchContext,
  parseRemoteDetails,
  sanitizeRemoteUrl,
  sanitizeWorkItemForAI,
} from "../packages/core/dist/index.js";
import { commitStagedChanges, getRepositoryInfo, runGit } from "../packages/git/dist/index.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

async function runVerification(): Promise<void> {
  const startTime = Date.now();
  console.log("===============================================================");
  console.log("GitWhisper Phase 8 Verification Script");
  console.log("Branch Intelligence, Issue References & Work-Item Integrations");
  console.log("===============================================================\n");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-phase8-verify-"));

  try {
    // [1/8] Sandbox setup
    console.log(`[1/8] Created temporary Git sandbox at: ${tempDir}`);
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Phase 8 Verifier"], { cwd: tempDir });
    await runGit(["config", "user.email", "phase8@gitwhisper.local"], { cwd: tempDir });

    await fs.writeFile(path.join(tempDir, "README.md"), "# GitWhisper Phase 8 Sandbox\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: initial sandbox baseline" });

    await runGit(["checkout", "-b", "feature/DEV-142-session-timeout"], { cwd: tempDir });
    console.log("      ✓ Git repository initialized on branch: feature/DEV-142-session-timeout.\n");

    // [2/8] Branch intelligence
    console.log("[2/8] Testing Branch Intelligence & Reference Extraction...");
    const branchContext = parseBranchContext("feature/DEV-142-session-timeout");
    if (branchContext.references.length !== 1 || branchContext.references[0].key !== "DEV-142") {
      throw new Error(
        `Failed to extract DEV-142 from branch name: ${JSON.stringify(branchContext)}`,
      );
    }
    if (branchContext.normalizedDescription !== "session timeout") {
      throw new Error(
        `Failed to extract normalized description: ${branchContext.normalizedDescription}`,
      );
    }
    console.log("      ✓ Branch reference DEV-142 and normalized description verified.\n");

    // [3/8] Remote parsing & credential scrubbing
    console.log("[3/8] Testing Git Remote Parsing & Credential Scrubbing...");
    const rawToken = ["ghp", "syntheticSecretToken12345"].join("_");
    const rawRemote = `https://bot:${rawToken}@github.com/ritualdev/gitwhisper.git`;
    const sanitized = sanitizeRemoteUrl(rawRemote);
    if (sanitized.includes(rawToken)) {
      throw new Error(`Remote URL failed to scrub credentials: ${sanitized}`);
    }
    const remoteDetails = parseRemoteDetails("origin", rawRemote);
    if (remoteDetails.owner !== "ritualdev" || remoteDetails.repository !== "gitwhisper") {
      throw new Error(`Remote details mismatch: ${JSON.stringify(remoteDetails)}`);
    }
    console.log("      ✓ Remote credential scrubbing and provider mapping verified.\n");

    // [4/8] Security Invariant: Credential host binding
    console.log("[4/8] Testing Release-Blocking Security Invariant: Credential Host Binding...");
    let hostBindingCaught = false;
    try {
      assertCredentialHostBinding(
        "https://attacker.example/rest/api/2/issue/DEV-142",
        "jira.company.example",
      );
    } catch (err: unknown) {
      if (err instanceof SecurityHostBindingError) {
        hostBindingCaught = true;
      }
    }
    if (!hostBindingCaught) {
      throw new Error(
        "FAILED: assertCredentialHostBinding did not block unauthorized host redirect!",
      );
    }
    console.log("      ✓ Release-blocking invariant verified: credentials strictly host-bound.\n");

    // [5/8] Relevance scoring & Conflict detection
    console.log("[5/8] Testing Work-Item Relevance Engine & Conflict Detection...");
    const mockContextAuth = {
      repository: {
        root: tempDir,
        name: "repo",
        branch: "feature/DEV-142",
        head: "123",
        isInitial: false,
      },
      files: [
        {
          path: "src/auth/session.ts",
          status: "modified" as const,
          binary: false,
          category: "source" as const,
        },
      ],
      stats: { filesChanged: 1, additions: 10, deletions: 2 },
      patch: "mock patch",
      diffMetadata: { originalBytes: 10, includedBytes: 10, truncated: false },
      characteristics: {
        hasTests: false,
        hasDocumentation: false,
        hasConfiguration: false,
        hasDependencies: false,
        hasBinaryChanges: false,
      },
      intelligence: {
        fileCategories: {
          total: 1,
          test: 0,
          documentation: 0,
          dependency: 0,
          configuration: 0,
          source: 1,
          binary: 0,
          unknown: 0,
        },
        affectedDirectories: ["src/auth"],
        packageChanges: [],
        configChanges: [],
        testChanges: [],
        documentationChanges: [],
        sourceChanges: ["src/auth/session.ts"],
        ciChanges: [],
        buildChanges: [],
        probableScopes: [{ scope: "auth", score: 0.9, reasons: [], confidence: "HIGH" as const }],
        probableTypes: [{ type: "fix", score: 0.9, reasons: [], confidence: "HIGH" as const }],
        signals: [],
      },
    };

    const workItem = {
      provider: "jira" as const,
      key: "DEV-142",
      title: "Refresh expiring auth sessions before timeout",
    };

    const authRel = evaluateIntentRelevance(workItem, branchContext, mockContextAuth);
    if (authRel.relevance !== "high") {
      throw new Error(`Expected HIGH relevance for auth changes, got: ${authRel.relevance}`);
    }

    // Docs conflict test: Issue describes OAuth, staged is README only
    const mockContextDocs = {
      ...mockContextAuth,
      files: [
        {
          path: "README.md",
          status: "modified" as const,
          binary: false,
          category: "documentation" as const,
        },
      ],
      characteristics: { ...mockContextAuth.characteristics, hasDocumentation: true },
    };
    const docsRel = evaluateIntentRelevance(workItem, branchContext, mockContextDocs);
    if (docsRel.relevance !== "low") {
      throw new Error(`Expected LOW relevance for docs conflict, got: ${docsRel.relevance}`);
    }
    console.log("      ✓ Relevance scoring and documentation-only conflict detection verified.\n");

    // [6/8] Privacy redaction on issue bodies
    console.log("[6/8] Testing Privacy Redaction on External Work-Item Payloads...");
    const rawSecret = "AKIAIOSFODNN7EXAMPLE";
    const sensitiveWorkItem = {
      provider: "jira" as const,
      key: "DEV-142",
      title: "Authentication key leak",
      description: `Discovered AWS credential: ${rawSecret} in logs`,
    };
    const sanitizedContext = await sanitizeWorkItemForAI(sensitiveWorkItem);
    if (sanitizedContext.relevantSummary?.includes(rawSecret)) {
      throw new Error("FAILED: Raw secret leaked through sanitizeWorkItemForAI!");
    }
    if (!sanitizedContext.relevantSummary?.includes("<GITWHISPER_REDACTED_AWS_KEY>")) {
      throw new Error("FAILED: Secret was not replaced with redacted token placeholder!");
    }
    console.log("      ✓ Work-item text sanitized and credentials redacted before AI delivery.\n");

    // [7/8] Reference footer generation
    console.log("[7/8] Testing Reference Trailer Formatting & Policy Invariant...");
    const defaultTrailer = formatReferenceTrailer("DEV-142");
    if (defaultTrailer !== "Refs DEV-142") {
      throw new Error(`Expected 'Refs DEV-142', got: ${defaultTrailer}`);
    }
    const fullCommit = insertReferenceIntoMessage(
      "fix(auth): refresh sessions before expiry",
      "DEV-142",
      { mode: "reference" },
    );
    if (!fullCommit.endsWith("\n\nRefs DEV-142")) {
      throw new Error(`Malformed commit trailer format: ${JSON.stringify(fullCommit)}`);
    }
    console.log("      ✓ Conservative reference footer formatting verified.\n");

    // [8/8] CLI verification & real Git commit execution
    console.log("[8/8] Testing CLI Issue Command & Staged Execution...");
    await fs.mkdir(path.join(tempDir, "src/auth"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src/auth/session.ts"),
      "export const refreshSession = () => ({ status: 'refreshed' });\n",
    );
    await runGit(["add", "src/auth/session.ts"], { cwd: tempDir });

    const { stdout: issueJson } = await execFileAsync(
      process.execPath,
      [CLI_PATH, "issue", "--json"],
      { cwd: tempDir },
    );
    const parsedIssue = JSON.parse(issueJson.trim());
    if (parsedIssue.references[0]?.key !== "DEV-142") {
      throw new Error(`CLI issue failed to detect DEV-142: ${issueJson}`);
    }

    // Execute real commit
    const commitMsg = insertReferenceIntoMessage(
      "fix(auth): refresh sessions before expiry",
      "DEV-142",
      { mode: "reference" },
    );
    const result = await commitStagedChanges(tempDir, {
      subject: "fix(auth): refresh sessions before expiry",
      body: "Refs DEV-142",
    });

    const logRes = await runGit(["log", "-1", "--pretty=fuller"], { cwd: tempDir });
    if (!logRes.stdout.includes("Refs DEV-142")) {
      throw new Error(`Git log does not contain Refs DEV-142: ${logRes.stdout}`);
    }
    console.log(
      `      ✓ Real Git commit ${result.commitHash.slice(0, 7)} executed with Refs DEV-142.`,
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n===============================================================");
    console.log(`✅ GitWhisper Phase 8 Verification PASSED (${duration}s)`);
    console.log("   - Branch intelligence & reference extraction: PASS");
    console.log("   - Remote parsing & credential scrubbing: PASS");
    console.log("   - Security invariant: credential host-binding: PASS");
    console.log("   - Work-item relevance scoring & conflict defense: PASS");
    console.log("   - Work-item secret detection & redaction: PASS");
    console.log("   - Conservative reference trailer policy: PASS");
    console.log("   - CLI issue command & work-item flags: PASS");
    console.log("   - Real Git commit execution with trailer: PASS");
    console.log("===============================================================\n");
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

runVerification().catch((err) => {
  console.error("\n❌ Phase 8 Verification Failed:");
  console.error(err);
  process.exit(1);
});
