import { execFile, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { runGit } from "@gitwhisper/git";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI End-to-End Workflow", () => {
  let server: http.Server;
  let port: number;
  let mockBaseUrl: string;
  let repo: TempRepo;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/api/chat" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                subject: "feat(auth): add session expiration check",
                body: "Ensures user sessions expire after inactivity.",
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
        port = addr.port;
        mockBaseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-e2e-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("runs --dry-run: generates message, displays box, never calls git commit", async () => {
    await repo.writeFile("src/session.ts", "export function checkSession() {}\n");
    await runGit(["add", "src/session.ts"], { cwd: repo.path });

    const { stdout } = await execFileAsync(
      "node",
      [cliEntry, "--dry-run", "--provider", "ollama", "--model", "qwen2.5-coder:7b"],
      {
        cwd: repo.path,
        env: {
          ...process.env,
          GITWHISPER_BASE_URL: mockBaseUrl,
        },
      },
    );

    expect(stdout).toContain("feat(auth): add session expiration check");
    expect(stdout).toContain("[Dry run] No commit was created");

    // Authoritatively verify no commit was made (HEAD should not exist in initial repo)
    await expect(runGit(["rev-parse", "HEAD"], { cwd: repo.path })).rejects.toThrow();
  });

  it("approves commit: executes real git commit, verifies commit hash and git log", async () => {
    await repo.writeFile("src/session.ts", "export function checkSession() {}\n");
    await runGit(["add", "src/session.ts"], { cwd: repo.path });

    // Spawn CLI and pipe Enter key (\n) to approve the proposed commit
    const child = spawn("node", [cliEntry, "--provider", "ollama", "--model", "qwen2.5-coder:7b"], {
      cwd: repo.path,
      env: {
        ...process.env,
        GITWHISPER_BASE_URL: mockBaseUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (d) => {
      output += d.toString();
    });

    // Send Enter to approve
    child.stdin.write("\n");
    child.stdin.end();

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", resolve);
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("Commit created");
    expect(output).toContain("feat(auth): add session expiration check");

    // Verify real commit exists in Git
    const headResult = await runGit(["rev-parse", "--short", "HEAD"], { cwd: repo.path });
    const realShortHash = headResult.stdout.trim();
    expect(output).toContain(realShortHash);

    const logResult = await runGit(["log", "-1", "--pretty=%B"], { cwd: repo.path });
    expect(logResult.stdout).toContain("feat(auth): add session expiration check");
    expect(logResult.stdout).toContain("Ensures user sessions expire after inactivity.");
  });
});
