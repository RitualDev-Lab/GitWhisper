import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitStagedChanges, runGit } from "@gitwhisper/git";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Hunk Plan Command (--level=hunk|file|auto)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-hunk-cli-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "CLI Hunk Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "hunk@gitwhisper.local"], { cwd: tempDir });

    // Initial commit
    const initialContent = [
      "export function funcA() { return 1; }",
      "",
      "// line 1",
      "// line 2",
      "// line 3",
      "// line 4",
      "// line 5",
      "// line 6",
      "// line 7",
      "// line 8",
      "// line 9",
      "// line 10",
      "",
      "export function funcB() { return 2; }",
    ].join("\n");

    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "app.ts"), initialContent, "utf8");
    await runGit(["add", "src/app.ts"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: root commit" });

    // Stage changes to both functions
    const modifiedContent = initialContent
      .replace("return 1;", "return 100;")
      .replace("return 2;", "return 200;");
    await fs.writeFile(path.join(tempDir, "src", "app.ts"), modifiedContent, "utf8");
    await runGit(["add", "src/app.ts"], { cwd: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("outputs valid JSON with hunk metadata when using --level=hunk", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, "plan", "--level=hunk", "--json"],
      { cwd: tempDir },
    );

    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty("totalHunks");
    expect(parsed.totalHunks).toBe(2);
    expect(parsed).toHaveProperty("groups");
    expect(parsed.groups[0]).toHaveProperty("hunkIds");
    expect(Array.isArray(parsed.groups[0].hunkIds)).toBe(true);
  });

  it("renders human-readable hunk identifiers in plan output", async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "plan", "--level=hunk"], {
      cwd: tempDir,
    });

    expect(stdout).toContain("Commit Plan (Hunk-Level Intelligence)");
    expect(stdout).toContain("f1:h1");
    expect(stdout).toContain("src/app.ts");
  });

  it("supports --level=file to force file-level commit planning", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, "plan", "--level=file", "--json"],
      { cwd: tempDir },
    );

    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toHaveProperty("totalFiles", 1);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].files).toContain("src/app.ts");
  });
});
