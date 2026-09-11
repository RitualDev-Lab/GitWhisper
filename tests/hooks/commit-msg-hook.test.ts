import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("Git Hook Commit-Msg Offline Execution", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-hook-exec-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("passes clean commit in warn mode", async () => {
    // Config: commitMsg = warn
    await repo.writeFile(".gitwhisper.json", JSON.stringify({ hooks: { commitMsg: "warn" } }));
    const msgFile = path.join(repo.dir, "COMMIT_MSG");
    await fs.writeFile(msgFile, "feat(core): implement new feature\n\nDetailed explanation.");

    const { stdout, stderr } = await execFileAsync(
      "node",
      [cliEntry, "hook", "commit-msg", msgFile],
      {
        cwd: repo.dir,
      },
    );

    expect(stderr).toBe("");
  });

  it("warns but allows commit on style warnings in warn mode", async () => {
    await repo.writeFile(".gitwhisper.json", JSON.stringify({ hooks: { commitMsg: "warn" } }));
    const msgFile = path.join(repo.dir, "COMMIT_MSG");
    await fs.writeFile(msgFile, "feat(core): update stuff."); // Trailing period & vague

    // Should NOT throw, exit 0
    const { stdout, stderr } = await execFileAsync(
      "node",
      [cliEntry, "hook", "commit-msg", msgFile],
      {
        cwd: repo.dir,
      },
    );

    expect(stderr).toContain("GitWhisper Quality Warning");
  });

  it("blocks commit even in warn mode if secret is detected", async () => {
    await repo.writeFile(".gitwhisper.json", JSON.stringify({ hooks: { commitMsg: "warn" } }));
    const msgFile = path.join(repo.dir, "COMMIT_MSG");
    const syntheticGhp = ["ghp", "123456789012345678901234567890123456"].join("_");
    await fs.writeFile(msgFile, `feat(auth): add key ${syntheticGhp}`);

    try {
      await execFileAsync("node", [cliEntry, "hook", "commit-msg", msgFile], {
        cwd: repo.dir,
      });
      expect.fail("Should have blocked commit containing secret");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("SECRET_IN_COMMIT_MESSAGE");
      expect(err.stderr).toContain("BLOCKED");
    }
  });

  it("blocks commit in strict mode on warnings or style issues", async () => {
    await repo.writeFile(".gitwhisper.json", JSON.stringify({ hooks: { commitMsg: "strict" } }));
    const msgFile = path.join(repo.dir, "COMMIT_MSG");
    await fs.writeFile(msgFile, "feat(core): update stuff");

    try {
      await execFileAsync("node", [cliEntry, "hook", "commit-msg", msgFile], {
        cwd: repo.dir,
      });
      expect.fail("Should have blocked commit in strict mode");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("GitWhisper Quality Rejected");
    }
  });

  it("allows commit in strict mode when message is fully compliant", async () => {
    await repo.writeFile(
      ".gitwhisper.json",
      JSON.stringify({
        hooks: { commitMsg: "strict" },
        commit: { allowedTypes: ["feat", "fix"] },
      }),
    );
    const msgFile = path.join(repo.dir, "COMMIT_MSG");
    await fs.writeFile(
      msgFile,
      "feat(core): implement robust data validation\n\nValidates incoming payloads.",
    );

    const { stdout, stderr } = await execFileAsync(
      "node",
      [cliEntry, "hook", "commit-msg", msgFile],
      {
        cwd: repo.dir,
      },
    );

    expect(stderr).toBe("");
  });
});
