import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Smoke Tests", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-cli-smoke-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("displays help with --help", async () => {
    const { stdout } = await execFileAsync("node", [cliEntry, "--help"]);
    expect(stdout).toContain("GitWhisper");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--dry-run");
  });

  it("displays version with --version", async () => {
    const { stdout } = await execFileAsync("node", [cliEntry, "--version"]);
    expect(stdout).toMatch(/gitwhisper v\d+\.\d+\.\d+/);
  });

  it("fails with code 1 and actionable message when outside a git repository", async () => {
    const nonRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-nonrepo-"));
    try {
      await execFileAsync("node", [cliEntry], { cwd: nonRepoDir });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe(1);
      const output = (err.stderr || "") + (err.stdout || "");
      expect(output).toContain("Not inside a Git repository");
      expect(output).toContain("git init");
    } finally {
      await fs.rm(nonRepoDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("fails with code 1 and clean guidance when repository has no staged changes", async () => {
    try {
      await execFileAsync("node", [cliEntry], { cwd: repo.path });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.code).toBe(1);
      const output = (err.stderr || "") + (err.stdout || "");
      expect(output).toContain("No staged changes found");
      expect(output).toContain("git add <files>");
      expect(output).toContain("Then run GitWhisper again");
    }
  });
});
