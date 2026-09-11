import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitStagedChanges, runGit } from "@gitwhisper/git";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Plan Command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-plan-cli-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "CLI Plan Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "plan@gitwhisper.local"], { cwd: tempDir });

    // Initial commit
    await fs.writeFile(path.join(tempDir, "README.md"), "# Project\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: init" });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("outputs valid JSON with --json flag", async () => {
    // Stage multi-concern changes
    await fs.mkdir(path.join(tempDir, "src", "auth"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "src", "ui"), { recursive: true });

    await fs.writeFile(path.join(tempDir, "src", "auth", "session.ts"), "export const s = 1;\n");
    await fs.writeFile(
      path.join(tempDir, "src", "ui", "nav.tsx"),
      "export const Nav = () => null;\n",
    );

    await runGit(["add", "src/auth/session.ts", "src/ui/nav.tsx"], { cwd: tempDir });

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "plan", "--json"], {
      cwd: tempDir,
    });

    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty("indexFingerprint");
    expect(parsed).toHaveProperty("totalFiles", 2);
    expect(parsed).toHaveProperty("groups");
    expect(Array.isArray(parsed.groups)).toBe(true);
    expect(parsed.groups.length).toBeGreaterThanOrEqual(2);
  });

  it("renders human-readable dashboard with --details", async () => {
    await fs.mkdir(path.join(tempDir, "src", "auth"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "tests", "auth"), { recursive: true });

    await fs.writeFile(path.join(tempDir, "src", "auth", "session.ts"), "export const s = 1;\n");
    await fs.writeFile(
      path.join(tempDir, "tests", "auth", "session.test.ts"),
      "test('s', () => {});\n",
    );

    await runGit(["add", "src/auth/session.ts", "tests/auth/session.test.ts"], { cwd: tempDir });

    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "plan", "--details"], {
      cwd: tempDir,
    });

    expect(stdout).toContain("Commit Plan");
    expect(stdout).toContain("Index Fingerprint");
    expect(stdout).toContain("source-test");
  });
});
