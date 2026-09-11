import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runGit } from "../packages/git/dist/index.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

async function main() {
  console.log("=== GitWhisper Phase 3: Section 56 Verification Scenarios ===\n");

  let lastGeneratedPrompt = "";
  let mockResponseContent = "";

  const server = http.createServer((req, res) => {
    if (req.url === "/api/chat" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const payload = JSON.parse(body);
        lastGeneratedPrompt = payload.messages?.[1]?.content || "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message: {
              content: mockResponseContent,
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
  const baseTmp = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-p3-scenario-"));

  try {
    // -------------------------------------------------------------
    // Scenario A: 50 Conventional Commit-style historical commits
    // -------------------------------------------------------------
    console.log("--- Scenario A: 50 Conventional Commits ---");
    const repoA = path.join(baseTmp, "repo-a");
    await fs.mkdir(repoA, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repoA });
    await runGit(["config", "user.name", "Tester A"], { cwd: repoA });
    await runGit(["config", "user.email", "tester-a@ritualdev.com"], { cwd: repoA });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: repoA });

    for (let i = 1; i <= 50; i++) {
      await fs.writeFile(path.join(repoA, `file-${i}.txt`), `commit ${i}\n`);
      await runGit(["add", "."], { cwd: repoA });
      const scope = i % 2 === 0 ? "auth" : "api";
      const type = i % 3 === 0 ? "fix" : "feat";
      await runGit(["commit", "-m", `${type}(${scope}): update item ${i}`], { cwd: repoA });
    }

    // Inspect style
    const { stdout: styleA } = await execFileAsync("node", [cliEntry, "style"], { cwd: repoA });
    console.log("Repository A Style output:");
    console.log(styleA);
    if (!styleA.includes("Conventional Commits") || !styleA.includes("Confidence     High")) {
      throw new Error("Scenario A failed: Expected Conventional Commits with High confidence");
    }

    // Stage source + test change
    await fs.writeFile(path.join(repoA, "src-auth.ts"), "export const login = () => true;\n");
    await fs.writeFile(path.join(repoA, "src-auth.test.ts"), "test('login', () => {});\n");
    await runGit(["add", "."], { cwd: repoA });

    mockResponseContent = JSON.stringify({
      type: "feat",
      scope: "auth",
      description: "add session login and test coverage",
      body: "Implements login function and adds corresponding unit tests.",
    });

    const { stdout: runA } = await execFileAsync(
      "node",
      [cliEntry, "--dry-run", "--provider", "ollama", "--base-url", mockBaseUrl],
      { cwd: repoA },
    );
    console.log("Repository A Run output:");
    console.log(runA);
    if (!runA.includes("feat(auth): add session login and test coverage")) {
      throw new Error("Scenario A failed: Expected conventional commit proposal");
    }
    if (!runA.includes("Repository style learned from 50 recent commits")) {
      throw new Error("Scenario A failed: Expected notice of learned style from 50 commits");
    }
    console.log("✓ Scenario A verified!\n");

    // -------------------------------------------------------------
    // Scenario B: 30 Simple sentence-style commits
    // -------------------------------------------------------------
    console.log("--- Scenario B: 30 Simple Sentence-Style Commits ---");
    const repoB = path.join(baseTmp, "repo-b");
    await fs.mkdir(repoB, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repoB });
    await runGit(["config", "user.name", "Tester B"], { cwd: repoB });
    await runGit(["config", "user.email", "tester-b@ritualdev.com"], { cwd: repoB });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: repoB });

    const simpleSubjects = [
      "Add OAuth callback handling",
      "Handle invalid refresh tokens",
      "Update authentication docs",
      "Improve session tests",
      "Refactor token parser",
      "Optimize session cache",
    ];

    for (let i = 1; i <= 30; i++) {
      await fs.writeFile(path.join(repoB, `file-${i}.txt`), `commit ${i}\n`);
      await runGit(["add", "."], { cwd: repoB });
      const subj = `${simpleSubjects[i % simpleSubjects.length]} ${i}`;
      await runGit(["commit", "-m", subj], { cwd: repoB });
    }

    const { stdout: styleB } = await execFileAsync("node", [cliEntry, "style"], { cwd: repoB });
    console.log("Repository B Style output:");
    console.log(styleB);
    if (!styleB.includes("Simple / Imperative") || !styleB.includes("Confidence     High")) {
      throw new Error("Scenario B failed: Expected Simple / Imperative with High confidence");
    }

    // Stage source + test change
    await fs.writeFile(path.join(repoB, "session.ts"), "export const session = () => {};\n");
    await runGit(["add", "."], { cwd: repoB });

    mockResponseContent = JSON.stringify({
      subject: "Handle expired authentication sessions",
      description: "Handle expired authentication sessions",
    });

    const { stdout: runB } = await execFileAsync(
      "node",
      [cliEntry, "--dry-run", "--provider", "ollama", "--base-url", mockBaseUrl],
      { cwd: repoB },
    );
    console.log("Repository B Run output:");
    console.log(runB);
    if (
      !runB.includes("Handle expired authentication sessions") ||
      runB.includes("feat(session):") ||
      runB.includes("fix(session):")
    ) {
      throw new Error(
        "Scenario B failed: Expected simple commit subject without conventional prefix",
      );
    }
    console.log("✓ Scenario B verified!\n");

    // -------------------------------------------------------------
    // Scenario C: Mixed history
    // -------------------------------------------------------------
    console.log("--- Scenario C: Mixed History ---");
    const repoC = path.join(baseTmp, "repo-c");
    await fs.mkdir(repoC, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repoC });
    await runGit(["config", "user.name", "Tester C"], { cwd: repoC });
    await runGit(["config", "user.email", "tester-c@ritualdev.com"], { cwd: repoC });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: repoC });

    for (let i = 1; i <= 20; i++) {
      await fs.writeFile(path.join(repoC, `file-${i}.txt`), `commit ${i}\n`);
      await runGit(["add", "."], { cwd: repoC });
      if (i % 2 === 0) {
        await runGit(["commit", "-m", `feat(auth): login ${i}`], { cwd: repoC });
      } else {
        await runGit(["commit", "-m", `Update documentation and cleanup ${i}`], { cwd: repoC });
      }
    }

    const { stdout: styleC } = await execFileAsync("node", [cliEntry, "style"], { cwd: repoC });
    console.log("Repository C Style output:");
    console.log(styleC);
    if (!styleC.includes("Convention     Mixed") && !styleC.includes("Confidence     Medium")) {
      throw new Error("Scenario C failed: Expected Mixed / Medium confidence");
    }
    console.log("✓ Scenario C verified!\n");

    // -------------------------------------------------------------
    // Scenario D: 0 commits brand new repository
    // -------------------------------------------------------------
    console.log("--- Scenario D: 0 Commits Brand New Repository ---");
    const repoD = path.join(baseTmp, "repo-d");
    await fs.mkdir(repoD, { recursive: true });
    await runGit(["init", "-b", "main"], { cwd: repoD });
    await runGit(["config", "user.name", "Tester D"], { cwd: repoD });
    await runGit(["config", "user.email", "tester-d@ritualdev.com"], { cwd: repoD });
    await runGit(["config", "commit.gpgsign", "false"], { cwd: repoD });

    const { stdout: styleD } = await execFileAsync("node", [cliEntry, "style"], { cwd: repoD });
    console.log("Repository D Style output:");
    console.log(styleD);
    if (!styleD.includes("No commit history available")) {
      throw new Error("Scenario D failed: Expected 'No commit history available'");
    }

    await fs.writeFile(path.join(repoD, "README.md"), "# New Repo\n");
    await runGit(["add", "."], { cwd: repoD });

    mockResponseContent = JSON.stringify({
      type: "docs",
      description: "initial commit with project readme",
    });

    const { stdout: runD } = await execFileAsync(
      "node",
      [cliEntry, "--dry-run", "--provider", "ollama", "--base-url", mockBaseUrl],
      { cwd: repoD },
    );
    console.log("Repository D Run output:");
    console.log(runD);
    if (!runD.includes("No commit history available. Using GitWhisper configured defaults")) {
      throw new Error("Scenario D failed: Expected fallback to defaults message");
    }
    console.log("✓ Scenario D verified!\n");

    console.log("==================================================================");
    console.log("ALL 4 MANUAL & AUTOMATED VERIFICATION SCENARIOS SUCCESSFULLY PASSED");
    console.log("==================================================================");
  } finally {
    server.close();
    await fs.rm(baseTmp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
