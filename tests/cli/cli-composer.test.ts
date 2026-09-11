import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { runGit } from "@gitwhisper/git";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Composer Non-TTY & Multi-Variant Options", () => {
  let server: http.Server;
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
                scope: "auth",
                breaking: false,
                variants: {
                  concise: {
                    description: "add session expiration check",
                    body: "",
                  },
                  descriptive: {
                    description: "add session expiration check to auth guard",
                    body: "Ensures inactive user sessions are terminated automatically.",
                  },
                  detailed: {
                    description:
                      "implement automated session expiration handling in authentication middleware",
                    body: "Revokes tokens after 30 minutes of user inactivity.\nImproves security against session hijacking.",
                  },
                },
                reasoning: ["Added expiration check in auth/guard.ts"],
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
    repo = await createTempGitRepo("gitwhisper-cli-comp-");
    await repo.writeFile("src/auth/guard.ts", "export const check = () => true;\n");
    await runGit(["add", "src/auth/guard.ts"], { cwd: repo.path });
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("pipes raw commit message in non-TTY mode without ANSI formatting or interactive menus", async () => {
    const env = {
      ...process.env,
      GITWHISPER_PROVIDER: "ollama",
      GITWHISPER_MODEL: "test-model",
      GITWHISPER_BASE_URL: mockBaseUrl,
    };

    const { stdout } = await execFileAsync("node", [cliEntry, "generate"], {
      cwd: repo.path,
      env,
    });

    // Clean commit message output for piping
    expect(stdout).toContain("feat(auth): add session expiration check to auth guard");
    expect(stdout).toContain("Ensures inactive user sessions are terminated automatically.");
    // MUST NOT contain interactive prompts or headers
    expect(stdout).not.toContain("Variants:");
    expect(stdout).not.toContain("[Enter] Commit");
  });

  it("outputs structured JSON with --json flag", async () => {
    const env = {
      ...process.env,
      GITWHISPER_PROVIDER: "ollama",
      GITWHISPER_MODEL: "test-model",
      GITWHISPER_BASE_URL: mockBaseUrl,
    };

    const { stdout } = await execFileAsync("node", [cliEntry, "generate", "--json"], {
      cwd: repo.path,
      env,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty("repository");
    expect(parsed).toHaveProperty("provider");
    expect(parsed).toHaveProperty("timing");
    expect(parsed).toHaveProperty("selectedVariant", "descriptive");
    expect(parsed.subject).toBe("feat(auth): add session expiration check to auth guard");
    expect(parsed.variants).toHaveProperty("length", 3);
  });

  it("respects --variant concise flag in piped output", async () => {
    const env = {
      ...process.env,
      GITWHISPER_PROVIDER: "ollama",
      GITWHISPER_MODEL: "test-model",
      GITWHISPER_BASE_URL: mockBaseUrl,
    };

    const { stdout } = await execFileAsync("node", [cliEntry, "generate", "--variant", "concise"], {
      cwd: repo.path,
      env,
    });

    expect(stdout.trim()).toBe("feat(auth): add session expiration check");
  });

  it("outputs clean message with --quiet flag", async () => {
    const env = {
      ...process.env,
      GITWHISPER_PROVIDER: "ollama",
      GITWHISPER_MODEL: "test-model",
      GITWHISPER_BASE_URL: mockBaseUrl,
    };

    const { stdout } = await execFileAsync("node", [cliEntry, "--quiet"], {
      cwd: repo.path,
      env,
    });

    expect(stdout).toContain("feat(auth): add session expiration check to auth guard");
    expect(stdout).not.toContain("GitWhisper");
  });
});
