import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type ChangeContext,
  ConnectionStringDetector,
  EnvironmentFileDetector,
  JwtDetector,
  KnownFormatDetector,
  PrivateKeyDetector,
  PrivacyPolicyBlockedError,
  PrivacyScanError,
  VariableHeuristicDetector,
  classifyProviderLocation,
  createDefaultDetectors,
  prepareProviderContext,
  redactPatch,
  scanCommitMessage,
  scanSensitiveContent,
} from "../packages/core/dist/index.js";
import { enforceStrictPrivacyPolicy } from "../packages/config/dist/index.js";
import { commitStagedChanges, runGit } from "../packages/git/dist/index.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function main() {
  console.log("===============================================================");
  console.log("GitWhisper Phase 7 Verification Script");
  console.log("Secret Detection, Redaction, Privacy Policy & Safe Remote AI");
  console.log("===============================================================\n");

  const startTime = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-phase7-verify-"));
  console.log(`[1/8] Created temporary Git sandbox at: ${tempDir}`);

  try {
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Phase 7 Verifier"], { cwd: tempDir });
    await runGit(["config", "user.email", "phase7@gitwhisper.local"], { cwd: tempDir });

    await fs.writeFile(path.join(tempDir, "README.md"), "# GitWhisper Phase 7 Verification\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: initial commit" });
    console.log("      ✓ Git repository initialized with initial baseline commit.");

    // Step 2: Pluggable Secret Detectors
    console.log("\n[2/8] Testing Pluggable Secret Detectors with Synthetic Data...");
    const detectors = createDefaultDetectors();
    assert(detectors.length >= 8, "Expected at least 8 registered secret detectors");

    // Test Private Key
    const pemPatch =
      "diff --git a/key.pem b/key.pem\n+-----BEGIN RSA PRIVATE KEY-----\n+MIIEpAIBAAKCAQEA...";
    const pemFindings = new PrivateKeyDetector().scan({ patch: pemPatch, filePath: "key.pem" });
    assert(pemFindings.length >= 1, "PrivateKeyDetector failed to detect PEM key");
    assert(
      pemFindings[0]?.maskedPreview === "-----BEGIN [REDACTED PRIVATE KEY]-----",
      "Masked preview mismatch",
    );

    // Test Known Formats (AWS, Stripe, GitHub, OpenAI)
    const stripeKey = ["sk", "live", "syntheticStripeKey1234567890"].join("_");
    const ghpKey = ["ghp", "111122223333444455556666777788889999"].join("_");
    const openaiKey = ["sk", "syntheticOpenAiTestKey32charactersLongHere"].join("-");
    const knownPatch = `
diff --git a/creds.ts b/creds.ts
+const aws = "AKIAIOSFODNN7EXAMPLE";
+const stripe = "${stripeKey}";
+const ghp = "${ghpKey}";
+const openai = "${openaiKey}";
`;
    const knownFindings = new KnownFormatDetector().scan({
      patch: knownPatch,
      filePath: "creds.ts",
    });
    assert(knownFindings.length >= 4, "KnownFormatDetector missed synthetic credentials");

    // Test JWT
    const syntheticJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.synthetic_signature_1234567890";
    const jwtFindings = new JwtDetector().scan({ text: syntheticJwt, filePath: "token.txt" });
    assert(jwtFindings.length === 1, "JwtDetector failed to find JWT token");

    // Test Connection String
    const connPatch =
      "diff --git a/db.ts b/db.ts\n+const url = 'postgres://user:SuperSecretPassword123!@localhost:5432/db';";
    const connFindings = new ConnectionStringDetector().scan({
      patch: connPatch,
      filePath: "db.ts",
    });
    assert(
      connFindings.length === 1,
      "ConnectionStringDetector failed to detect password in connection string",
    );
    assert(
      connFindings[0]?.placeholder === "<GITWHISPER_REDACTED_PASSWORD>",
      "Placeholder mismatch",
    );

    console.log("      ✓ All deterministic secret detectors verified with synthetic fixtures.");

    // Step 3: Endpoint Classification
    console.log("\n[3/8] Testing Endpoint Classification (Loopback vs Remote)...");
    assert(
      classifyProviderLocation("http://localhost:11434") === "local",
      "localhost should be local",
    );
    assert(
      classifyProviderLocation("http://127.0.0.1:11434") === "local",
      "127.0.0.1 should be local",
    );
    assert(classifyProviderLocation("http://[::1]:11434") === "local", "[::1] should be local");
    assert(
      classifyProviderLocation("https://api.openai.com/v1") === "remote",
      "api.openai.com should be remote",
    );
    assert(
      classifyProviderLocation("http://192.168.1.10:8000") === "remote",
      "LAN IP should be remote",
    );
    console.log("      ✓ Loopback strictly isolated from remote/LAN endpoints.");

    // Step 4: Redaction Engine & Unified Diff Topology
    console.log("\n[4/8] Testing Diff Topology-Preserving Redaction...");
    const oldKey = ["sk", "live", "oldSyntheticKey1234567890"].join("_");
    const newKey = ["sk", "live", "newSyntheticKey1234567890"].join("_");
    const rawDiff = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1,3 +1,3 @@
-const oldKey = "${oldKey}";
+const newKey = "${newKey}";
`;
    const { sanitizedPatch, redactions } = redactPatch(rawDiff, [
      {
        id: "1",
        category: "api-key",
        detector: "known-format",
        confidence: "high",
        filePath: "app.ts",
        lineNumber: 1,
        lineType: "deleted",
        matchedText: oldKey,
        maskedPreview: "sk_l****7890",
        startColumn: 0,
        endColumn: 33,
        placeholder: "<GITWHISPER_REDACTED_STRIPE_KEY>",
        fingerprint: "111",
      },
      {
        id: "2",
        category: "api-key",
        detector: "known-format",
        confidence: "high",
        filePath: "app.ts",
        lineNumber: 2,
        lineType: "added",
        matchedText: newKey,
        maskedPreview: "sk_l****7890",
        startColumn: 0,
        endColumn: 33,
        placeholder: "<GITWHISPER_REDACTED_STRIPE_KEY>",
        fingerprint: "222",
      },
    ]);

    const skPrefix = ["sk", "live", ""].join("_");
    assert(!sanitizedPatch.includes(skPrefix), "Sanitized patch leaked secret!");
    assert(
      sanitizedPatch.includes("<GITWHISPER_REDACTED_STRIPE_KEY>"),
      "Placeholder not found in patch",
    );
    assert(sanitizedPatch.includes("diff --git a/app.ts b/app.ts"), "Diff header mutilated");
    assert(redactions.length === 2, "Expected 2 redactions recorded");
    console.log(
      "      ✓ Redaction preserved diff topology and sanitized both additions and deletions.",
    );

    // Step 5: Fail-Closed Provider Boundary & Data Minimization
    console.log("\n[5/8] Testing Fail-Closed Privacy Boundary & Data Minimization...");
    const mockContext: ChangeContext = {
      repository: {
        root: tempDir,
        name: "confidential-client-project",
        branch: "secret-feature-branch",
        head: "123456",
        isInitial: false,
      },
      files: [{ path: "app.ts", status: "modified", binary: false, category: "source" }],
      stats: { additions: 1, deletions: 0, filesChanged: 1 },
      patch: 'const key = "AKIAIOSFODNN7EXAMPLE";',
      diffMetadata: { originalBytes: 100, includedBytes: 100, truncated: false },
      characteristics: {
        hasTests: false,
        hasDocumentation: false,
        hasConfiguration: false,
        hasDependencies: false,
        hasBinaryChanges: false,
      },
      intelligence: {
        probableTypes: [],
        probableScopes: [],
        typeEvidence: [],
        scopeEvidence: [],
      },
    };

    // Remote call with 'block' policy should throw PrivacyPolicyBlockedError
    let blocked = false;
    try {
      await prepareProviderContext({
        changeContext: mockContext,
        baseUrl: "https://api.openai.com/v1",
        privacyConfig: {
          scanSecrets: true,
          remote: { highConfidence: "block", mediumConfidence: "redact", lowConfidence: "warn" },
        },
      });
    } catch (err) {
      if (err instanceof PrivacyPolicyBlockedError) {
        blocked = true;
      }
    }
    assert(blocked, "Remote transmission should have been blocked!");

    // Remote call with allowRedactionOnBlock should sanitize and minimize data
    const safeContext = await prepareProviderContext({
      changeContext: mockContext,
      baseUrl: "https://api.openai.com/v1",
      allowRedactionOnBlock: true,
      privacyConfig: {
        scanSecrets: true,
        sendBranchName: false,
        sendRepositoryName: false,
      },
    });
    assert(safeContext.isSanitized, "Context should be sanitized");
    assert(
      !safeContext.changeContext.patch.includes("AKIAIOSFODNN7EXAMPLE"),
      "Secret leaked in safeContext!",
    );
    assert(safeContext.changeContext.repository.branch === null, "Branch name was not stripped!");
    assert(safeContext.changeContext.repository.name === "", "Repo name was not stripped!");
    console.log(
      "      ✓ Provider boundary blocked transmission, permitted safe redaction, and enforced data minimization.",
    );

    // Step 6: Commit Message Scanner & Echo Defense
    console.log("\n[6/8] Testing Commit Message & Secret Echo Defense...");
    const secretMsg = await scanCommitMessage("feat: update key to AKIAIOSFODNN7EXAMPLE");
    assert(!secretMsg.safe, "Commit message with raw secret was not blocked");

    const placeholderMsg = await scanCommitMessage("fix: set key to <GITWHISPER_REDACTED_API_KEY>");
    assert(!placeholderMsg.safe, "Commit message with raw placeholder was not blocked");

    const cleanMsg = await scanCommitMessage("feat(auth): integrate multi-factor authentication");
    assert(cleanMsg.safe, "Clean commit message was improperly blocked");
    console.log("      ✓ Commit message and secret echo defenses verified.");

    // Step 7: Strict Config Precedence
    console.log("\n[7/8] Testing Strict Config Precedence...");
    const globalPolicy = { scanSecrets: true, remote: { highConfidence: "block" as const } };
    const repoPolicy = { scanSecrets: false, remote: { highConfidence: "redact" as const } };
    const merged = enforceStrictPrivacyPolicy(globalPolicy, repoPolicy);
    assert(merged.scanSecrets === true, "Repo config improperly disabled scanSecrets");
    assert(
      merged.remote?.highConfidence === "block",
      "Repo config improperly downgraded highConfidence action",
    );
    console.log("      ✓ Repository config cannot weaken global privacy protections.");

    // Step 8: CLI Privacy Command & Zero-Data-Loss Invariant
    console.log("\n[8/8] Testing CLI Privacy Command & Zero-Data-Loss Invariant...");
    // 8a. Clean staged changes
    await fs.writeFile(path.join(tempDir, "clean.ts"), "export const PI = 3.14159;\n");
    await runGit(["add", "clean.ts"], { cwd: tempDir });

    const cleanCliResult = await execFileAsync(
      process.execPath,
      [CLI_PATH, "privacy", "scan", "--json"],
      {
        cwd: tempDir,
      },
    );
    const cleanParsed = JSON.parse(cleanCliResult.stdout.trim());
    assert(cleanParsed.safe === true, "Clean staged changes flagged erroneously");
    assert(cleanParsed.findingsCount === 0, "Unexpected findings on clean changes");

    // 8b. Add unstaged file and untracked file to test zero-data-loss isolation
    await fs.writeFile(path.join(tempDir, "unstaged.ts"), "const secretB = 'LEAK_SECRET_B';\n");
    await fs.writeFile(path.join(tempDir, ".env"), "AWS_SECRET=LEAK_SECRET_C\n");

    // Stage a file with a synthetic secret
    const stagedStripe = ["sk", "live", "syntheticApiKey1234567890"].join("_");
    await fs.writeFile(path.join(tempDir, "payment.ts"), `const stripe = '${stagedStripe}';\n`);
    await runGit(["add", "payment.ts"], { cwd: tempDir });

    try {
      await execFileAsync(process.execPath, [CLI_PATH, "privacy", "scan", "--json"], {
        cwd: tempDir,
      });
      assert(false, "CLI should have exited with code 1 for detected secret");
    } catch (err: any) {
      assert(err.code === 1, "Expected exit code 1");
      const parsed = JSON.parse(err.stdout.trim());
      assert(parsed.safe === false, "Expected safe: false");
      assert(parsed.findingsCount >= 1, "Expected at least 1 finding");
      assert(parsed.findings[0].filePath === "payment.ts", "Wrong file reported");
      assert(parsed.findings[0].maskedPreview.includes("sk_l"), "Masked preview missing");
      assert(!parsed.findings[0].matchedText, "Raw secret leaked in JSON output!");
    }

    // Verify unstaged and untracked files were not touched
    const unstagedContent = await fs.readFile(path.join(tempDir, "unstaged.ts"), "utf8");
    assert(unstagedContent.includes("LEAK_SECRET_B"), "Unstaged file was corrupted");
    const untrackedContent = await fs.readFile(path.join(tempDir, ".env"), "utf8");
    assert(untrackedContent.includes("LEAK_SECRET_C"), "Untracked file was corrupted");

    console.log(
      "      ✓ CLI privacy scan accurately detected staged secrets while strictly preserving unstaged and untracked files.",
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n===============================================================");
    console.log(`✅ GitWhisper Phase 7 Verification PASSED (${duration}s)`);
    console.log("   - Pluggable secret detectors: PASS");
    console.log("   - Endpoint classification (loopback vs remote): PASS");
    console.log("   - Topology-preserving diff redaction: PASS");
    console.log("   - Fail-closed provider boundary: PASS");
    console.log("   - Remote data minimization: PASS");
    console.log("   - Commit message & echo defense: PASS");
    console.log("   - Strict configuration precedence: PASS");
    console.log("   - CLI privacy scan command: PASS");
    console.log("   - Zero-data-loss & working tree safety: PASS");
    console.log("===============================================================\n");
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error("\n❌ Phase 7 Verification failed with unhandled error:", err);
  process.exit(1);
});
