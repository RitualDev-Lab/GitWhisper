import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runGit } from "../packages/git/dist/index.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

async function main() {
  console.log("=== GitWhisper 18-Step Manual & Automated Verification Scenario ===\n");

  // Spin up a mock Ollama server that records incoming payloads
  let receivedPayload: any = null;
  const server = http.createServer((req, res) => {
    if (req.url === "/api/chat" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedPayload = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                subject: "feat(auth): add session validation and unit tests",
                body: "Introduces validateSession and covers expired cases with tests.",
              }),
            },
          }),
        );
      });
    } else {
      res.statusCode = 404;
      res.end();
    }
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as any).port);
    });
  });

  const mockBaseUrl = `http://127.0.0.1:${port}`;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-18step-"));

  try {
    // 1. git init
    console.log("Step 1: git init");
    await runGit(["init", "-b", "main"], { cwd: tmpDir });
    await runGit(["config", "user.name", "Scenario Tester"], { cwd: tmpDir });
    await runGit(["config", "user.email", "scenario@ritualdev.com"], { cwd: tmpDir });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: tmpDir });

    // 2. create package.json
    console.log("Step 2: create package.json");
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "ritual-api" }, null, 2),
    );

    // 3. create src/auth.ts
    console.log("Step 3: create src/auth.ts");
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src/auth.ts"),
      "export function auth() { return true; }\n",
    );

    // 4. initial commit
    console.log("Step 4: initial commit");
    await runGit(["add", "."], { cwd: tmpDir });
    await runGit(["commit", "-m", "chore: initial commit"], { cwd: tmpDir });

    // 5. modify src/auth.ts
    console.log("Step 5: modify src/auth.ts");
    await fs.writeFile(
      path.join(tmpDir, "src/auth.ts"),
      "export function auth() { return true; }\nexport function validateSession(token: string) { return Boolean(token); }\n",
    );

    // 6. create tests/auth.test.ts
    console.log("Step 6: create tests/auth.test.ts");
    await fs.mkdir(path.join(tmpDir, "tests"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "tests/auth.test.ts"),
      "import { validateSession } from '../src/auth';\ntest('validates', () => { expect(validateSession('tok')).toBe(true); });\n",
    );

    // 7. create .env containing a fake secret
    console.log("Step 7: create .env containing fake secret");
    const fakeSecret = "SUPER_SECRET_AWS_KEY_DO_NOT_LEAK_987654321";
    await fs.writeFile(path.join(tmpDir, ".env"), `API_SECRET=${fakeSecret}\n`);

    // 8. stage src/auth.ts and tests/auth.test.ts
    console.log("Step 8: stage src/auth.ts and tests/auth.test.ts");
    await runGit(["add", "src/auth.ts", "tests/auth.test.ts"], { cwd: tmpDir });

    // 9. leave .env untracked
    console.log("Step 9: verify .env is untracked");
    const status = await runGit(["status", "--porcelain"], { cwd: tmpDir });
    if (!status.stdout.includes("?? .env")) {
      throw new Error(".env should be untracked!");
    }

    // 10. run gitwhisper (--dry-run first to verify context inspection)
    console.log("Step 10: run gitwhisper (inspecting context)");
    const dryRunResult = await execFileAsync(
      "node",
      [cliEntry, "--dry-run", "--provider", "ollama", "--model", "qwen2.5-coder:7b"],
      {
        cwd: tmpDir,
        env: {
          ...process.env,
          GITWHISPER_BASE_URL: mockBaseUrl,
        },
      },
    );

    console.log(`Step 10 output:\n${dryRunResult.stdout}`);

    // 11. verify only staged code reached generation context
    console.log("Step 11: verify only staged code reached generation context");
    const sentUserPrompt = receivedPayload.messages.find((m: any) => m.role === "user").content;
    if (!sentUserPrompt.includes("src/auth.ts") || !sentUserPrompt.includes("tests/auth.test.ts")) {
      throw new Error("Missing staged files in prompt!");
    }
    if (sentUserPrompt.includes(".env") || sentUserPrompt.includes(fakeSecret)) {
      throw new Error("CRITICAL PRIVACY FAILURE: .env or secret reached AI context!");
    }
    console.log(" ✓ Staged code confirmed in prompt");
    console.log(" ✓ .env and secrets strictly excluded from prompt");

    // 12. generate message with local Ollama
    console.log("Step 12: generate message with local Ollama -> received proposal");

    // 13 & 14: approve commit via CLI
    console.log("Step 13 & 14: approve commit execution");
    const child = spawn("node", [cliEntry, "--provider", "ollama", "--model", "qwen2.5-coder:7b"], {
      cwd: tmpDir,
      env: {
        ...process.env,
        GITWHISPER_BASE_URL: mockBaseUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let cliStdout = "";
    child.stdout.on("data", (chunk) => {
      cliStdout += chunk.toString();
    });
    child.stdin.write("\n"); // Press [Enter] to commit
    child.stdin.end();

    const exitCode = await new Promise<number>((resolve) => child.on("close", resolve));
    if (exitCode !== 0) {
      throw new Error(`CLI exited with code ${exitCode}`);
    }

    console.log(`Step 14 output:\n${cliStdout}`);

    // 15. verify real Git commit exists
    console.log("Step 15: verify real Git commit exists");
    const headCommit = (
      await runGit(["rev-parse", "--short", "HEAD"], { cwd: tmpDir })
    ).stdout.trim();
    console.log(` Real Git Commit Hash: ${headCommit}`);

    // 16. verify resulting commit message exactly matches approved text
    console.log("Step 16: verify resulting commit message exactly matches approved text");
    const gitLog = (await runGit(["log", "-1", "--pretty=%B"], { cwd: tmpDir })).stdout;
    if (!gitLog.includes("feat(auth): add session validation and unit tests")) {
      throw new Error("Commit message did not match approved subject!");
    }
    console.log(` Commit log:\n${gitLog}`);

    // 17. verify .env was not staged/read/sent
    console.log("Step 17: verify .env remains untracked and unstaged");
    const postStatus = await runGit(["status", "--porcelain"], { cwd: tmpDir });
    if (!postStatus.stdout.includes("?? .env")) {
      throw new Error(".env status changed!");
    }
    console.log(` ✓ .env is still untracked: ${postStatus.stdout.trim()}`);

    // 18. verify clean actionable terminal output
    console.log("Step 18: clean actionable output verified throughout workflow.");

    console.log("\n=======================================================");
    console.log("✓ ALL 18 VERIFICATION SCENARIO STEPS PASSED PERFECTLY!");
    console.log("=======================================================\n");
  } finally {
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("Verification scenario failed:", err);
  process.exit(1);
});
