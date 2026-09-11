import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runGit } from "@gitwhisper/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Timeline Command (gitwhisper timeline)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-cli-timeline-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("fails with code 1 when executed outside a Git repository", async () => {
    const nonRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-nonrepo-"));
    try {
      await execFileAsync("node", [cliEntry, "timeline"], { cwd: nonRepoDir });
      expect.fail("Should have failed outside repo");
    } catch (err: any) {
      expect(err.code).toBe(1);
      const output = (err.stderr || "") + (err.stdout || "");
      expect(output).toContain("Not inside a Git repository");
    } finally {
      await fs.rm(nonRepoDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns JSON when --json flag is provided", async () => {
    await repo.writeFile("src/main.ts", "console.log('init');");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "chore: initial commit"], { cwd: repo.path });

    const { stdout } = await execFileAsync("node", [cliEntry, "timeline", "--json"], {
      cwd: repo.path,
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.commits).toHaveLength(1);
    expect(parsed.summary.totalCommits).toBe(1);
    expect(parsed.workstreams).toHaveLength(1);
  });

  it("renders human-readable timeline dashboard with workstreams", async () => {
    await repo.writeFile("src/auth.ts", "export const login = true;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(auth): login service DEV-100"], { cwd: repo.path });

    await repo.writeFile("src/billing.ts", "export const invoice = true;");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(billing): invoice service"], { cwd: repo.path });

    const { stdout } = await execFileAsync("node", [cliEntry, "timeline", "--details"], {
      cwd: repo.path,
    });

    expect(stdout).toContain("Commit Timeline & Repository History Intelligence");
    expect(stdout).toContain("Analyzed 2 commits");
    expect(stdout).toContain("feat(auth): login service DEV-100");
    expect(stdout).toContain("feat(billing): invoice service");
    expect(stdout).toContain("Files:");
  });
});
