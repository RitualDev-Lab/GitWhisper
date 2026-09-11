import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { commitStagedChanges, runGit } from "@gitwhisper/git";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Issue Command & Work-Item Flags", () => {
  let server: http.Server;
  let mockBaseUrl: string;
  let tempDir: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/api/tags" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "test-model" }] }));
      } else if (req.url === "/api/chat" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                type: "fix",
                scope: "auth",
                breaking: false,
                variants: {
                  concise: { description: "fix auth timeout", body: "" },
                  descriptive: { description: "fix auth timeout issue", body: "" },
                  detailed: { description: "fix authentication timeout issue", body: "" },
                },
                reasoning: ["fix auth timeout"],
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
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-issue-cli-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "CLI Issue Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "issue@gitwhisper.local"], { cwd: tempDir });

    // Initial commit
    await fs.writeFile(path.join(tempDir, "README.md"), "# Project\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: initial baseline" });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("detects issue reference from branch name in gitwhisper issue --json", async () => {
    await runGit(["checkout", "-b", "feature/DEV-142-session-timeout"], { cwd: tempDir });

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "issue", "--json"], {
      cwd: tempDir,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.branch).toBe("feature/DEV-142-session-timeout");
    expect(parsed.references.length).toBe(1);
    expect(parsed.references[0].key).toBe("DEV-142");
    expect(parsed.references[0].source).toBe("branch");
  });

  it("accepts explicit issue key argument: gitwhisper issue PROJ-872 --json", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, "issue", "PROJ-872", "--json"],
      { cwd: tempDir },
    );

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.references.length).toBeGreaterThanOrEqual(1);
    const proj = parsed.references.find((r: { key: string }) => r.key === "PROJ-872");
    expect(proj).toBeDefined();
    expect(proj.source).toBe("user");
  });

  it("prints human-readable summary in standard terminal output", async () => {
    await runGit(["checkout", "-b", "feature/DEV-142-session-timeout"], { cwd: tempDir });

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "issue"], { cwd: tempDir });

    expect(stdout).toContain("Branch Intelligence & Work-Item Context");
    expect(stdout).toContain("feature/DEV-142-session-timeout");
    expect(stdout).toContain("DEV-142");
  });

  it("includes workItem metadata in gitwhisper --json when branch contains ticket", async () => {
    await runGit(["checkout", "-b", "fix/GH-99-auth-timeout"], { cwd: tempDir });

    await fs.writeFile(path.join(tempDir, "auth.ts"), "export const timeout = 5000;\n");
    await runGit(["add", "auth.ts"], { cwd: tempDir });

    const env = {
      ...process.env,
      GITWHISPER_PROVIDER: "ollama",
      GITWHISPER_MODEL: "test-model",
      GITWHISPER_BASE_URL: mockBaseUrl,
    };

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "--json"], {
      cwd: tempDir,
      env,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.workItem).toBeDefined();
    expect(parsed.workItem.key).toBe("#99");
  });
});
