import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHookStatus, installCommitMsgHook, uninstallCommitMsgHook } from "@gitwhisper/git";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

describe("Git Hook Manager & Non-Destructive Chaining", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-hooks-mgr-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("reports not installed when hook does not exist", async () => {
    const status = await getHookStatus(repo.dir, "commit-msg");
    expect(status.installed).toBe(false);
    expect(status.managedByGitWhisper).toBe(false);
  });

  it("installs a standalone commit-msg hook and reports installed", async () => {
    const installResult = await installCommitMsgHook(repo.dir);
    expect(installResult.success).toBe(true);
    expect(installResult.installed).toBe(true);
    expect(installResult.chained).toBe(false);

    const status = await getHookStatus(repo.dir, "commit-msg");
    expect(status.installed).toBe(true);
    expect(status.managedByGitWhisper).toBe(true);
    expect(status.isExecutable).toBe(true);

    const content = await fs.readFile(status.hookPath, "utf8");
    expect(content).toContain("gitwhisper hook commit-msg");
  });

  it("uninstalls a standalone commit-msg hook cleanly", async () => {
    await installCommitMsgHook(repo.dir);
    const uninstalled = await uninstallCommitMsgHook(repo.dir);
    expect(uninstalled.success).toBe(true);

    const status = await getHookStatus(repo.dir, "commit-msg");
    expect(status.installed).toBe(false);
  });

  it("refuses to silently overwrite existing user hook without force flag", async () => {
    const hooksDir = path.join(repo.dir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "commit-msg");
    await fs.writeFile(hookPath, "#!/bin/sh\necho 'custom user linter'\nexit 0\n", { mode: 0o755 });

    const res = await installCommitMsgHook(repo.dir, { force: false });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Existing commit-msg hook detected");

    // Verify user script was NOT modified
    const content = await fs.readFile(hookPath, "utf8");
    expect(content).toContain("custom user linter");
    expect(content).not.toContain("gitwhisper hook");
  });

  it("chains non-destructively into existing user hook when force: true", async () => {
    const hooksDir = path.join(repo.dir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, "commit-msg");
    await fs.writeFile(hookPath, "#!/bin/sh\necho 'user hook runs first'\n", { mode: 0o755 });

    const installResult = await installCommitMsgHook(repo.dir, { force: true });
    expect(installResult.success).toBe(true);
    expect(installResult.installed).toBe(true);
    expect(installResult.chained).toBe(true);

    const content = await fs.readFile(hookPath, "utf8");
    expect(content).toContain("user hook runs first");
    expect(content).toContain("# --- GitWhisper Managed Hook Chain ---");
    expect(content).toContain("gitwhisper hook commit-msg");

    // Check status reports chained
    const status = await getHookStatus(repo.dir, "commit-msg");
    expect(status.installed).toBe(true);
    expect(status.managedByGitWhisper).toBe(true);
    expect(status.isChained).toBe(true);

    // Uninstall should preserve user script and only remove GitWhisper chain
    const uninstalled = await uninstallCommitMsgHook(repo.dir);
    expect(uninstalled.success).toBe(true);

    const unchainedContent = await fs.readFile(hookPath, "utf8");
    expect(unchainedContent).toContain("user hook runs first");
    expect(unchainedContent).not.toContain("GitWhisper Managed Hook Chain");
  });
});
