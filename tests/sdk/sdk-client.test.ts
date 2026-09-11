import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runGit } from "@gitwhisper/git";
import {
  createGitWhisper,
  GitWhisperClientImpl,
  GitWhisperError,
  GitWhisperErrorCode,
} from "@gitwhisper/core";
import { createTempGitRepo, type TempRepo } from "../helpers/git-test-helper.js";

describe("Phase 12 — Reusable Core SDK (@gitwhisper/core)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-sdk-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("fails initialization when path is not a git repository", async () => {
    await expect(createGitWhisper({ repository: "non_existent_folder_xyz_123" })).rejects.toThrow();
  });

  it("initializes GitWhisper client on a valid repository", async () => {
    const client = await createGitWhisper({ repository: repo.path });
    expect(client).toBeDefined();
    expect(client.repository).toBe(repo.path);

    const status = await client.getRepositoryStatus();
    expect(status.hasStagedChanges).toBe(false);
    expect(status.branch).toBe("main");
  });

  it("throws EMPTY_STAGING_AREA error when analyzing with no staged changes", async () => {
    const client = await createGitWhisper({ repository: repo.path });
    await expect(client.analyzeStagedChanges()).rejects.toMatchObject({
      code: "EMPTY_STAGING_AREA",
    });
  });

  it("analyzes staged changes and emits analysis lifecycle events", async () => {
    await repo.writeFile("src/utils.ts", "export const add = (a: number, b: number) => a + b;");
    await runGit(["add", "src/utils.ts"], { cwd: repo.path });

    const client = await createGitWhisper({ repository: repo.path });

    const events: string[] = [];
    client.on("analysis:start", () => events.push("start"));
    client.on("analysis:complete", (payload) => {
      events.push(`complete:${payload.filesCount}`);
    });

    const context = await client.analyzeStagedChanges();
    expect(context.files.length).toBe(1);
    expect(context.files[0].path).toBe("src/utils.ts");
    expect(events).toContain("start");
    expect(events).toContain("complete:1");
  });

  it("generates commit proposal and multi-variants without mutating git state", async () => {
    await repo.writeFile("src/auth.ts", "export const login = () => true;");
    await runGit(["add", "src/auth.ts"], { cwd: repo.path });

    const client = await createGitWhisper({ repository: repo.path });

    const genResult = await client.generateCommit();
    expect(genResult.proposal).toBeDefined();
    expect(genResult.variants.length).toBe(3);
    expect(genResult.privacy.scanPassed).toBe(true);

    // Assert that Git state was not mutated (changes remain staged, 0 commits made)
    const status = await client.getRepositoryStatus();
    expect(status.hasStagedChanges).toBe(true);

    const logRes = await runGit(["rev-parse", "HEAD"], { cwd: repo.path }).catch(() => null);
    expect(logRes).toBeNull(); // 0 commits made
  });

  it("aborts operations when AbortSignal is triggered", async () => {
    await repo.writeFile("src/test.ts", "const x = 1;");
    await runGit(["add", "src/test.ts"], { cwd: repo.path });

    const client = await createGitWhisper({ repository: repo.path });

    const controller = new AbortController();
    controller.abort();

    await expect(client.analyzeStagedChanges({ signal: controller.signal })).rejects.toMatchObject({
      code: "OPERATION_ABORTED",
    });
  });

  it("commits staged changes only when commit() is explicitly invoked", async () => {
    await repo.writeFile("src/index.ts", "console.log('hello');");
    await runGit(["add", "src/index.ts"], { cwd: repo.path });

    const client = await createGitWhisper({ repository: repo.path });

    const commitEvents: string[] = [];
    client.on("commit:start", (p) => commitEvents.push(`start:${p.message}`));
    client.on("commit:complete", (p) => commitEvents.push(`complete:${p.commitHash}`));

    const result = await client.commit("feat(core): initialize main entrypoint");
    expect(result.hash).toBeDefined();
    expect(result.message).toContain("initialize main entrypoint");

    expect(commitEvents.length).toBe(2);
    expect(commitEvents[0]).toContain("start:feat(core): initialize main entrypoint");

    // Staging area is now clean
    const status = await client.getRepositoryStatus();
    expect(status.hasStagedChanges).toBe(false);
  });
});
