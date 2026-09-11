import { getCommitHistory, isRevertCommit, isShallowRepository, runGit } from "@gitwhisper/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

describe("Git History Reader & Delimiter Extraction", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-history-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("handles empty repository with 0 commits gracefully", async () => {
    const history = await getCommitHistory(repo.path);
    expect(history).toEqual([]);
  });

  it("correctly extracts a single commit with structured fields", async () => {
    await repo.writeFile("hello.txt", "world\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(
      [
        "commit",
        "-m",
        "feat(core): initial commit",
        "-m",
        "This is a detailed body.\nIt spans multiple lines.\n",
      ],
      { cwd: repo.path },
    );

    const history = await getCommitHistory(repo.path);
    expect(history).toHaveLength(1);
    expect(history[0].hash).toMatch(/^[a-f0-9]{40}$/);
    expect(history[0].subject).toBe("feat(core): initial commit");
    expect(history[0].body).toContain("This is a detailed body.");
    expect(history[0].body).toContain("It spans multiple lines.");
    expect(history[0].parents).toEqual([]);
    expect(history[0].authorDate).toBeDefined();
  });

  it("handles multiple commits in reverse chronological order", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.writeFile(`file-${i}.txt`, `content ${i}\n`);
      await runGit(["add", "."], { cwd: repo.path });
      await runGit(["commit", "-m", `feat(module): add feature ${i}`], { cwd: repo.path });
    }

    const history = await getCommitHistory(repo.path, { limit: 3 });
    expect(history).toHaveLength(3);
    expect(history[0].subject).toBe("feat(module): add feature 5");
    expect(history[1].subject).toBe("feat(module): add feature 4");
    expect(history[2].subject).toBe("feat(module): add feature 3");
  });

  it("handles Unicode characters and special symbols in subjects and bodies", async () => {
    await repo.writeFile("unicode.txt", "test\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(
      [
        "commit",
        "-m",
        "fix(i18n): support 日本語, Español & 🚀 emoji",
        "-m",
        "Body with symbols: !@#$%^&*() and quotes \"quoted text\" and 'single'.",
      ],
      { cwd: repo.path },
    );

    const history = await getCommitHistory(repo.path);
    expect(history).toHaveLength(1);
    expect(history[0].subject).toBe("fix(i18n): support 日本語, Español & 🚀 emoji");
    expect(history[0].body).toContain("Body with symbols: !@#$%^&*()");
  });

  it("filters merge commits by default and includes them when requested", async () => {
    // 1. Initial commit on main
    await repo.writeFile("main.txt", "main content\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "chore: initial main commit"], { cwd: repo.path });

    // 2. Branch feature
    await runGit(["checkout", "-b", "feature-branch"], { cwd: repo.path });
    await repo.writeFile("feature.txt", "feature content\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(auth): add auth feature"], { cwd: repo.path });

    // 3. Back to main, create diverging commit
    await runGit(["checkout", "-"], { cwd: repo.path });
    await repo.writeFile("diverge.txt", "diverge content\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "fix(api): fix api bug"], { cwd: repo.path });

    // 4. Merge feature branch with a merge commit
    await runGit(["merge", "--no-ff", "feature-branch", "-m", "Merge branch 'feature-branch'"], {
      cwd: repo.path,
    });

    // Default: exclude merge commits
    const defaultHistory = await getCommitHistory(repo.path, { includeMerges: false });
    expect(defaultHistory.some((c) => c.subject.startsWith("Merge branch"))).toBe(false);
    expect(defaultHistory.length).toBe(3); // 3 regular commits

    // With includeMerges: true
    const fullHistory = await getCommitHistory(repo.path, { includeMerges: true });
    expect(fullHistory.some((c) => c.subject.startsWith("Merge branch"))).toBe(true);
    expect(fullHistory.length).toBe(4);
  });

  it("identifies revert commits correctly", () => {
    expect(isRevertCommit('Revert "feat(auth): add login"')).toBe(true);
    expect(isRevertCommit("revert(auth): rollback expired session")).toBe(true);
    expect(isRevertCommit("revert: bad change")).toBe(true);
    expect(isRevertCommit("feat(auth): add revert button in ui")).toBe(false);
  });

  it("extracts changed files when withFiles: true is specified", async () => {
    await repo.writeFile("packages/auth/token.ts", "token\n");
    await repo.writeFile("packages/auth/session.ts", "session\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "feat(auth): add token and session"], { cwd: repo.path });

    const history = await getCommitHistory(repo.path, { withFiles: true });
    expect(history).toHaveLength(1);
    expect(history[0].files).toBeDefined();
    expect(history[0].files).toContain("packages/auth/token.ts");
    expect(history[0].files).toContain("packages/auth/session.ts");
  });

  it("checks shallow repository status accurately", async () => {
    const isShallow = await isShallowRepository(repo.path);
    expect(isShallow).toBe(false);
  });
});
