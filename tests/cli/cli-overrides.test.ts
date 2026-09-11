import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { runGit } from "@gitwhisper/git";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Overrides & Detected Intelligence Display", () => {
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
                type: "feat",
                scope: "session",
                description: "validate session tokens",
                body: "Added expiration checks for session tokens.",
                breaking: false,
                reasoning: ["Added session validation function"],
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
    repo = await createTempGitRepo("gitwhisper-cli-overrides-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("displays Detected Type, Scope, and Confidence in terminal output", async () => {
    await repo.writeFile("src/session/token.ts", "export function token() {}\n");
    await runGit(["add", "src/session/token.ts"], { cwd: repo.path });

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

    expect(stdout).toContain("Detected");
    expect(stdout).toContain("Type");
    expect(stdout).toContain("Scope");
    expect(stdout).toContain("session");
    expect(stdout).toContain("Confidence");
    expect(stdout).toContain("feat(session): validate session tokens");
  });
});
