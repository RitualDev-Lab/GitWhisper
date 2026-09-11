import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "@gitwhisper/git";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Check Command (gitwhisper check)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-cli-check-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("outputs structured JSON when --json flag is passed", async () => {
    const { stdout } = await execFileAsync(
      "node",
      [cliEntry, "check", "feat(auth): add OAuth2 token refresh", "--json"],
      { cwd: repo.dir },
    );

    const parsed = JSON.parse(stdout);
    expect(parsed.score).toBeGreaterThanOrEqual(90);
    expect(parsed.rating).toBe("excellent");
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.issues)).toBe(true);
  });

  it("exits with code 1 in --strict mode when warnings are present", async () => {
    try {
      await execFileAsync(
        "node",
        [cliEntry, "check", "feat(core): update stuff", "--strict", "--json"],
        { cwd: repo.dir },
      );
      expect.fail("Should have failed in strict mode with vague description warning");
    } catch (err: any) {
      expect(err.code).toBe(1);
      const parsed = JSON.parse(err.stdout);
      expect(parsed.valid).toBe(false);
      expect(parsed.issues.some((i: any) => i.code === "VAGUE_DESCRIPTION")).toBe(true);
    }
  });

  it("checks committed changes using commit-ish (HEAD)", async () => {
    await repo.writeFile("src/service.ts", "export const service = true;");
    await runGit(["add", "."], { cwd: repo.dir });
    await runGit(["commit", "-m", "feat(service): initialize core service"], { cwd: repo.dir });

    const { stdout } = await execFileAsync("node", [cliEntry, "check", "HEAD", "--json"], {
      cwd: repo.dir,
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.rating).toBe("excellent");
  });

  it("exits with code 2 outside of a git repository", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-no-git-"));
    try {
      await execFileAsync("node", [cliEntry, "check", "feat: test", "--json"], {
        cwd: tmpDir,
      });
      expect.fail("Should have exited with code 2");
    } catch (err: any) {
      expect(err.code).toBe(2);
      const parsed = JSON.parse(err.stdout);
      expect(parsed.error.code).toBe("NOT_A_GIT_REPOSITORY");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
