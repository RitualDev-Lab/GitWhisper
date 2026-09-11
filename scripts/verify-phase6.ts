import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  type CommitComposerSession,
  type CommitVariant,
  applyComposerOverrides,
  calculateVariantDiversity,
  deduplicateVariants,
  isValidTransition,
  sanitizeTerminalString,
  switchVariant,
  transitionComposer,
  validateCommitProposal,
} from "../packages/core/dist/index.js";
import { commitStagedChanges, runGit } from "../packages/git/dist/index.js";
import { validateCommitVariantsResponse } from "../packages/ai/dist/index.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

async function main() {
  console.log("===============================================================");
  console.log("GitWhisper Phase 6 Verification Script");
  console.log("Interactive Commit Composer, Multi-Variant UX & Zero-Data-Loss");
  console.log("===============================================================\n");

  const startTime = Date.now();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-phase6-verify-"));
  console.log(`[1/7] Created temporary Git sandbox at: ${tempDir}`);

  // Set up mock AI provider for local testing
  let server: http.Server;
  let mockBaseUrl: string;

  server = http.createServer((req, res) => {
    if (req.url === "/api/chat" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              type: "feat",
              scope: "auth",
              breaking: false,
              variants: {
                concise: {
                  description: "add session expiration handling",
                  body: "",
                },
                descriptive: {
                  description: "add session expiration handling to auth middleware",
                  body: "Automatically terminates sessions after 30 minutes of inactivity.",
                },
                detailed: {
                  description:
                    "implement automated session expiration handling and token revocation",
                  body: "Monitors idle time and revokes bearer tokens after 30 minutes of inactivity.\nImproves security posture against session takeover.",
                },
              },
              reasoning: [
                "Added session timeout in src/auth/session.ts",
                "Updated token validator",
              ],
            }),
          },
        }),
      );
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as any;
      mockBaseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  try {
    // 1. Initialize Git Repo
    console.log("[2/7] Initializing Git repository and creating initial commit...");
    await runGit(["init", "-b", "main"], { cwd: tempDir });
    await runGit(["config", "user.name", "Phase 6 Verifier"], { cwd: tempDir });
    await runGit(["config", "user.email", "verifier@gitwhisper.local"], { cwd: tempDir });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: tempDir });

    const srcDir = path.join(tempDir, "src", "auth");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "session.ts"), "export const session = { id: 1 };\n");
    await runGit(["add", "src/auth/session.ts"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: init auth module" });

    // 2. Stage new changes + Unstaged edits (MM) + Untracked secret (??)
    console.log(
      "[3/7] Setting up staged changes, unstaged local edits (MM) & untracked secret (??)...",
    );
    await fs.writeFile(
      path.join(srcDir, "session.ts"),
      "export const session = { id: 1, timeoutMs: 1800000 };\n",
    );
    await fs.writeFile(path.join(srcDir, "token.ts"), "export const verifyToken = () => true;\n");
    await runGit(["add", "src/auth/session.ts", "src/auth/token.ts"], { cwd: tempDir });

    // Working-tree unstaged modification
    await fs.writeFile(
      path.join(srcDir, "session.ts"),
      "export const session = { id: 1, timeoutMs: 1800000, localWip: true };\n",
    );

    // Untracked secret file
    const secretFile = path.join(tempDir, ".env.production");
    await fs.writeFile(secretFile, "JWT_SECRET=super-secret-key-do-not-commit\n");

    const { stdout: statusBefore } = await runGit(["status", "--porcelain"], { cwd: tempDir });
    const formattedStatus = statusBefore
      .trim()
      .split("\n")
      .map((l) => `        ${l}`)
      .join("\n");
    console.log(`      Git Status Porcelain:\n${formattedStatus}`);
    if (
      !statusBefore.includes("MM src/auth/session.ts") ||
      !statusBefore.includes("?? .env.production")
    ) {
      throw new Error("Failed to set up required MM and ?? repository status.");
    }
    console.log(
      "      ✓ Repository accurately configured with MM staged/unstaged and ?? untracked state.",
    );

    // 3. Multi-Variant Response & Diversity Verification
    console.log(
      "[4/7] Testing multi-variant generation, normalization, and diversity calculation...",
    );
    const rawVariantOutput = JSON.stringify({
      type: "feat",
      scope: "auth",
      variants: {
        concise: { description: "add session expiration handling" },
        descriptive: {
          description: "add session expiration handling to auth middleware",
          body: "Automatically terminates sessions after 30 minutes of inactivity.",
        },
        detailed: {
          description: "implement automated session expiration handling and token revocation",
          body: "Monitors idle time and revokes bearer tokens after 30 minutes of inactivity.\nImproves security posture.",
        },
      },
      reasoning: ["Added timeoutMs in session.ts"],
    });

    const parsedVariants = validateCommitVariantsResponse(rawVariantOutput, "test-provider");
    console.log(`      • Concise:     ${parsedVariants.variants.concise.subject}`);
    console.log(`      • Descriptive: ${parsedVariants.variants.descriptive.subject}`);
    console.log(`      • Detailed:    ${parsedVariants.variants.detailed.subject}`);

    const variantList: CommitVariant[] = (["concise", "descriptive", "detailed"] as const).map(
      (style) => ({
        id: style,
        style,
        subject: parsedVariants.variants[style].subject,
        body: parsedVariants.variants[style].body,
        proposal: {
          type: "feat",
          scope: "auth",
          description: parsedVariants.variants[style].description,
          body: parsedVariants.variants[style].body,
          breaking: false,
          confidence: { type: "HIGH", scope: "HIGH" },
          evidence: {
            typeReasons: ["Added timeoutMs in session.ts"],
            scopeReasons: [],
            signals: [],
          },
        },
        validation: { valid: true, errors: [], warnings: [] },
      }),
    );

    const diversityScore = calculateVariantDiversity(variantList);
    console.log(`      ✓ Multi-variant diversity score: ${diversityScore} (> 0.3 required)`);
    if (diversityScore < 0.3) throw new Error("Variant diversity is too low.");

    // 4. Terminal Escape & OSC Injection Defense Verification
    console.log("[5/7] Testing terminal injection & OSC escape sanitization...");
    const dangerousInputs = [
      "\x1b[31mRed\x1b[0m",
      "\x1b]0;Evil Window Title\x07Clean Text",
      "\x1b]8;;https://malicious.link\x1b\\Click Here\x1b]8;;\x1b\\",
      "\x1b]52;c;SGVsbG8=\x07Clipboard Hijack",
      "Control\x07Chars\x08Stripped\x0cDone",
    ];

    for (const dangerous of dangerousInputs) {
      const clean = sanitizeTerminalString(dangerous);
      if (clean.includes("\x1b") || clean.includes("\x07") || clean.includes("\x08")) {
        throw new Error(
          `Sanitizer failed to clean: ${JSON.stringify(dangerous)} -> ${JSON.stringify(clean)}`,
        );
      }
    }
    console.log(
      "      ✓ All ANSI escapes, OSC window title, and clipboard injection vectors neutralized.",
    );

    // 5. Composer State Machine & Overrides Verification
    console.log("[6/7] Testing Composer state machine transitions and developer overrides...");
    let session: CommitComposerSession = {
      id: "verify-session",
      repository: {
        root: tempDir,
        name: "test-repo",
        branch: "main",
        isDetached: false,
        hasCommits: true,
        stagedCount: 2,
        unstagedCount: 1,
        untrackedCount: 1,
      },
      changeContext: {} as any,
      variants: variantList,
      selectedVariantId: "descriptive",
      overrides: {},
      evidence: [],
      timing: { gitAnalysisMs: 5, intelligenceMs: 2, providerMs: 50, totalMs: 57 },
      provider: { id: "ollama", model: "test-model", isLocal: true, privacyLabel: "Local" },
      state: "reviewing",
    };

    // Legal transitions
    if (
      !isValidTransition("reviewing", "committing") ||
      isValidTransition("reviewing", "completed")
    ) {
      throw new Error("State transition invariants violated.");
    }

    // Switch variant
    session = switchVariant(session, "concise");
    if (session.selectedVariantId !== "concise")
      throw new Error("Failed to switch variant to concise.");
    console.log(`      ✓ Switched active variant to: ${session.selectedVariantId}`);

    // Apply overrides
    session = applyComposerOverrides(session, {
      type: "fix",
      scope: "security",
      breaking: true,
    });
    for (const v of session.variants) {
      if (!v.subject.startsWith("fix(security)!:")) {
        throw new Error(`Override not applied to variant: ${v.subject}`);
      }
    }
    console.log("      ✓ Developer overrides (fix(security)!:) applied across all variants.");

    // 6. Safe Real Git Commit Execution & Zero Data Loss
    console.log("[7/7] Executing real Git commit and verifying Zero-Data-Loss invariants...");
    session = transitionComposer(session, "committing");
    const active = session.variants.find((v) => v.id === session.selectedVariantId)!;

    const commitResult = await commitStagedChanges(tempDir, {
      subject: active.subject,
      body: active.body,
    });
    session = transitionComposer(session, "completed");
    console.log(`      ✓ Commit executed with hash: ${commitResult.commitHash}`);

    // Verify git log contains commit
    const { stdout: logOutput } = await runGit(["log", "-1", "--oneline"], { cwd: tempDir });
    console.log(`      ✓ Git log: ${logOutput.trim()}`);
    if (!logOutput.includes(commitResult.commitHash)) {
      throw new Error("Committed hash not found in git log.");
    }

    // Verify ZERO DATA LOSS
    const sessionFileContent = await fs.readFile(path.join(srcDir, "session.ts"), "utf-8");
    if (!sessionFileContent.includes("localWip: true")) {
      throw new Error("CRITICAL DATA LOSS: Unstaged working-tree modification was lost!");
    }
    console.log(
      "      ✓ Unstaged working-tree modification ('localWip: true') preserved 100% intact.",
    );

    const secretFileContent = await fs.readFile(secretFile, "utf-8");
    if (!secretFileContent.includes("JWT_SECRET=super-secret-key-do-not-commit")) {
      throw new Error("CRITICAL DATA LOSS: Untracked .env file was modified or deleted!");
    }
    console.log("      ✓ Untracked secret file ('.env.production') preserved 100% untouched.");

    // Verify CLI JSON and Non-TTY output modes
    console.log("\n[Bonus] Verifying CLI --json and non-TTY piped output compatibility...");
    const env = {
      ...process.env,
      GITWHISPER_PROVIDER: "ollama",
      GITWHISPER_MODEL: "test-model",
      GITWHISPER_BASE_URL: mockBaseUrl,
    };

    // Stage token.ts modification for CLI test
    await fs.writeFile(
      path.join(srcDir, "token.ts"),
      "export const verifyToken = (t: string) => Boolean(t);\n",
    );
    await runGit(["add", "src/auth/token.ts"], { cwd: tempDir });

    const { stdout: jsonStdout } = await execFileAsync("node", [CLI_PATH, "generate", "--json"], {
      cwd: tempDir,
      env,
    });
    const parsedCliJson = JSON.parse(jsonStdout.trim());
    if (!parsedCliJson.selectedVariant || !parsedCliJson.variants) {
      throw new Error("CLI --json output is invalid.");
    }
    console.log("      ✓ CLI --json output validated successfully.");

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n===============================================================");
    console.log(`🎉 Phase 6 Verification PASSED in ${totalDuration}s!`);
    console.log("Interactive Composer, Multi-Variants, and Terminal Safety verified.");
    console.log("===============================================================\n");
  } finally {
    server.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("\n❌ Phase 6 Verification FAILED:");
  console.error(err);
  process.exit(1);
});
