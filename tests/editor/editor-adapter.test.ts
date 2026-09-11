import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runGit } from "@gitwhisper/git";
import { MyIDEAdapter, formatVariantsForQuickPick } from "@gitwhisper/editor";
import { createGitWhisper } from "@gitwhisper/core";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

describe("Phase 13 — Editor + MyIDE Integration (@gitwhisper/editor)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-editor-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("initializes adapter with IDEContext and executes analytical actions safely", async () => {
    await repo.writeFile("src/service.ts", "export class AuthService {}");
    await runGit(["add", "src/service.ts"], { cwd: repo.path });

    const adapter = new MyIDEAdapter({
      repositoryRoot: repo.path,
      editorName: "MyIDE-VSCode",
      activeFilePath: "src/service.ts",
    });

    const genRes = await adapter.generateCommitMessage();
    expect(genRes.success).toBe(true);
    expect(genRes.data).toBeDefined();
    expect(genRes.data?.proposal.description).toBeDefined();

    // Verify explainCommit returns structured evidence view
    const explainRes = await adapter.explainCommit();
    expect(explainRes.success).toBe(true);
    expect(explainRes.data?.filesCount).toBe(1);
    expect(explainRes.data?.privacyBadge).toBeDefined();
    expect(explainRes.data?.reasons.length).toBeGreaterThan(0);
  });

  it("translates error gracefully when staging area is empty", async () => {
    const adapter = new MyIDEAdapter({
      repositoryRoot: repo.path,
      editorName: "MyIDE",
    });

    const res = await adapter.generateCommitMessage();
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("EMPTY_STAGING_AREA");
  });

  it("strictly enforces developer approval invariant for executeApprovedCommit", async () => {
    await repo.writeFile("src/model.ts", "export interface User { id: string; }");
    await runGit(["add", "src/model.ts"], { cwd: repo.path });

    const adapter = new MyIDEAdapter({
      repositoryRoot: repo.path,
      editorName: "MyIDE",
    });

    // 1. Attempt to execute without confirmation
    const rejectedRes = await adapter.executeApprovedCommit("feat(model): add User model", {
      confirmed: false,
    });
    expect(rejectedRes.success).toBe(false);
    expect(rejectedRes.error?.code).toBe("CONFIRMATION_REQUIRED");

    // Verify nothing was committed
    const headCheck = await runGit(["rev-parse", "HEAD"], { cwd: repo.path }).catch(() => null);
    expect(headCheck).toBeNull();

    // 2. Execute with explicit confirmation
    const approvedRes = await adapter.executeApprovedCommit("feat(model): add User model", {
      confirmed: true,
    });
    expect(approvedRes.success).toBe(true);
    expect(approvedRes.data?.hash).toBeDefined();

    // Verify commit was actually made
    const committedHead = await runGit(["rev-parse", "HEAD"], { cwd: repo.path });
    expect(committedHead.stdout.trim()).toBeDefined();
  });

  it("formats variants for IDE QuickPick presentation", () => {
    const variants = [
      { id: "concise", subject: "feat: add user auth", description: "user authentication" },
      {
        id: "descriptive",
        subject: "feat(auth): implement user authentication",
        description: "user authentication",
        body: "Adds login endpoint",
      },
    ];

    const quickPicks = formatVariantsForQuickPick(variants);
    expect(quickPicks.length).toBe(2);
    expect(quickPicks[0].label).toBe("feat: add user auth");
    expect(quickPicks[0].variantId).toBe("concise");
    expect(quickPicks[1].detail).toBe("Adds login endpoint");
  });
});
