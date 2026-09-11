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

describe("CLI Style Command", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-cli-style-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("fails with code 1 when executed outside a Git repository", async () => {
    const nonRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-nonrepo-"));
    try {
      await execFileAsync("node", [cliEntry, "style"], { cwd: nonRepoDir });
      expect.fail("Should have failed outside repo");
    } catch (err: any) {
      expect(err.code).toBe(1);
      const output = (err.stderr || "") + (err.stdout || "");
      expect(output).toContain("Not inside a Git repository");
    } finally {
      await fs.rm(nonRepoDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("handles empty repository with 0 commits gracefully", async () => {
    const { stdout } = await execFileAsync("node", [cliEntry, "style"], { cwd: repo.path });
    expect(stdout).toContain("GitWhisper Repository Style");
    expect(stdout).toContain("No commit history available");
  });

  it("analyzes repository style and prints human-readable dashboard", async () => {
    // Commit 10 conventional commits
    for (let i = 1; i <= 10; i++) {
      await repo.writeFile(`file-${i}.txt`, `line ${i}\n`);
      await runGit(["add", "."], { cwd: repo.path });
      await runGit(["commit", "-m", `feat(core): add feature ${i}`], { cwd: repo.path });
    }

    const { stdout } = await execFileAsync("node", [cliEntry, "style"], { cwd: repo.path });
    expect(stdout).toContain("GitWhisper Repository Style");
    expect(stdout).toContain("Analyzed       10 commits");
    expect(stdout).toContain("Convention     Conventional Commits");
    expect(stdout).toContain("Confidence     High");
    expect(stdout).toContain("casing       lowercase");
    expect(stdout).toContain("core");
  });

  it("outputs valid JSON when --json flag is provided", async () => {
    for (let i = 1; i <= 6; i++) {
      await repo.writeFile(`file-${i}.txt`, `line ${i}\n`);
      await runGit(["add", "."], { cwd: repo.path });
      await runGit(["commit", "-m", `fix(api): handle timeout ${i}`], { cwd: repo.path });
    }

    const { stdout } = await execFileAsync("node", [cliEntry, "style", "--json"], {
      cwd: repo.path,
    });
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty("sampleSize", 6);
    expect(parsed.convention.style).toBe("conventional");
    expect(parsed.convention.confidence).toBe("HIGH");
    expect(parsed.types[0].type).toBe("fix");
    expect(parsed.scopes[0].scope).toBe("api");
  });

  it("outputs extended evidence when --details flag is provided", async () => {
    for (let i = 1; i <= 6; i++) {
      await repo.writeFile(`packages/editor/file-${i}.ts`, `line ${i}\n`);
      await runGit(["add", "."], { cwd: repo.path });
      await runGit(["commit", "-m", `feat(editor): improve editor ${i}`], { cwd: repo.path });
    }

    const { stdout } = await execFileAsync("node", [cliEntry, "style", "--details"], {
      cwd: repo.path,
    });
    expect(stdout).toContain("Detailed Statistics");
    expect(stdout).toContain("Conventional Ratio");
    expect(stdout).toContain("Types breakdown");
    expect(stdout).toContain("Historical Path-to-Scope Mappings");
    expect(stdout).toContain("packages/editor");
  });
});
