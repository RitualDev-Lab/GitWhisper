import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Hooks Command (gitwhisper hooks)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-cli-hooks-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("reports hooks status as uninstalled initially in --json output", async () => {
    const { stdout } = await execFileAsync("node", [cliEntry, "hooks", "status", "--json"], {
      cwd: repo.dir,
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.installed).toBe(false);
  });

  it("installs commit-msg hook via `gitwhisper hooks install`", async () => {
    const { stdout } = await execFileAsync("node", [cliEntry, "hooks", "install", "--json"], {
      cwd: repo.dir,
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.installed).toBe(true);

    // Verify status now reports installed
    const statusOutput = await execFileAsync("node", [cliEntry, "hooks", "status", "--json"], {
      cwd: repo.dir,
    });
    const status = JSON.parse(statusOutput.stdout);
    expect(status.installed).toBe(true);
    expect(status.managedByGitWhisper).toBe(true);
  });

  it("uninstalls commit-msg hook via `gitwhisper hooks uninstall`", async () => {
    await execFileAsync("node", [cliEntry, "hooks", "install"], { cwd: repo.dir });

    const { stdout } = await execFileAsync("node", [cliEntry, "hooks", "uninstall", "--json"], {
      cwd: repo.dir,
    });

    const parsed = JSON.parse(stdout);
    expect(parsed.installed).toBe(false);
  });
});
