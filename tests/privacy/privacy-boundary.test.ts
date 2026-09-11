import { buildChangeContext } from "@gitwhisper/core";
import { runGit } from "@gitwhisper/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TempRepo, createTempGitRepo } from "../helpers/git-test-helper.js";

describe("Critical Privacy Boundary (Release-Blocking Test)", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("gitwhisper-privacy-test-");
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it("strictly isolates staged changes: File A staged, File B unstaged, File C untracked", async () => {
    // 1. Initial baseline commit
    await repo.writeFile("src/file-b.ts", "export const b = 'initial-clean';\n");
    await runGit(["add", "."], { cwd: repo.path });
    await runGit(["commit", "-m", "chore: initial commit"], { cwd: repo.path });

    // 2. Setup File A (STAGED)
    const fileAContent = "export function featureA() { return 'STAGED_FEATURE_A'; }\n";
    await repo.writeFile("src/file-a.ts", fileAContent);
    await runGit(["add", "src/file-a.ts"], { cwd: repo.path });

    // 3. Setup File B (UNSTAGED MODIFICATION)
    const fileBUnstagedContent = "export const b = 'UNSTAGED_LEAK_SECRET_B_DO_NOT_INCLUDE';\n";
    await repo.writeFile("src/file-b.ts", fileBUnstagedContent);
    // Explicitly DO NOT run git add for file-b.ts

    // 4. Setup File C (UNTRACKED FILE)
    const fileCSecretContent = "AWS_SECRET_KEY=UNTRACKED_SUPER_SECRET_TOKEN_C_12345\n";
    await repo.writeFile(".env", fileCSecretContent);
    // Explicitly DO NOT run git add for .env

    // 5. Build generation context
    const context = await buildChangeContext(repo.path);

    // --- ASSERTIONS ---

    // Assertion 1: Staged File A must be present in files list and patch
    const fileA = context.files.find((f) => f.path === "src/file-a.ts");
    expect(fileA).toBeDefined();
    expect(fileA?.status).toBe("added");
    expect(context.patch).toContain("STAGED_FEATURE_A");

    // Assertion 2: Unstaged File B must NOT be in files list and unstaged content must NOT be in patch
    const fileB = context.files.find((f) => f.path === "src/file-b.ts");
    expect(fileB).toBeUndefined();
    expect(context.patch).not.toContain("UNSTAGED_LEAK_SECRET_B_DO_NOT_INCLUDE");

    // Assertion 3: Untracked File C must NOT be in files list and secret must NOT be in patch
    const fileC = context.files.find((f) => f.path === ".env");
    expect(fileC).toBeUndefined();
    expect(context.patch).not.toContain("AWS_SECRET_KEY");
    expect(context.patch).not.toContain("UNTRACKED_SUPER_SECRET_TOKEN_C_12345");

    // Assertion 4: Context files length should be exactly 1
    expect(context.files).toHaveLength(1);
  });
});
