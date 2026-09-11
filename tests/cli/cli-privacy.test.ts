import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitStagedChanges, runGit } from "@gitwhisper/git";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(process.cwd(), "apps/cli/dist/index.js");

describe("CLI Privacy Command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-privacy-cli-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "CLI Privacy Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "privacy@gitwhisper.local"], { cwd: tempDir });

    // Initial commit
    await fs.writeFile(path.join(tempDir, "README.md"), "# Project\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: initial baseline" });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("passes with exit code 0 when staged changes contain no secrets", async () => {
    await fs.writeFile(
      path.join(tempDir, "feature.ts"),
      "export const add = (a: number, b: number) => a + b;\n",
    );
    await runGit(["add", "feature.ts"], { cwd: tempDir });

    const { stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, "privacy", "scan", "--json"],
      {
        cwd: tempDir,
      },
    );

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.safe).toBe(true);
    expect(parsed.findingsCount).toBe(0);
    expect(parsed.findings).toEqual([]);
  });

  it("flags synthetic secrets with exit code 1 and outputs masked JSON with --json", async () => {
    const syntheticKey = ["sk", "live", "syntheticStripeKey123456789012"].join("_");
    await fs.writeFile(
      path.join(tempDir, "payment.ts"),
      `export const stripeSecret = "${syntheticKey}";\n`,
    );
    await runGit(["add", "payment.ts"], { cwd: tempDir });

    try {
      await execFileAsync(process.execPath, [CLI_PATH, "privacy", "scan", "--json"], {
        cwd: tempDir,
      });
      expect.unreachable("CLI should have exited with code 1 on detected secrets");
    } catch (err: any) {
      expect(err.code).toBe(1);
      const parsed = JSON.parse(err.stdout.trim());
      expect(parsed.safe).toBe(false);
      expect(parsed.findingsCount).toBeGreaterThanOrEqual(1);

      const finding = parsed.findings[0];
      expect(finding.filePath).toBe("payment.ts");
      expect(finding.maskedPreview).toMatch(/sk_l\*\*\*\*9012/);
      expect(finding.placeholder).toBe("<GITWHISPER_REDACTED_STRIPE_KEY>");
      // Crucial: matchedText MUST NEVER be output in the JSON
      expect(finding).not.toHaveProperty("matchedText");
    }
  });

  it("prints human-readable summary in standard terminal output", async () => {
    const syntheticAws = "AKIAIOSFODNN7EXAMPLE";
    await fs.writeFile(path.join(tempDir, "aws.ts"), `export const key = "${syntheticAws}";\n`);
    await runGit(["add", "aws.ts"], { cwd: tempDir });

    try {
      await execFileAsync(process.execPath, [CLI_PATH, "privacy", "scan"], {
        cwd: tempDir,
      });
      expect.unreachable("CLI should have exited with code 1");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stdout).toContain("Privacy Scan Warning");
      expect(err.stdout).toContain("aws.ts");
      expect(err.stdout).toContain("[HIGH]");
      expect(err.stdout).toContain("<GITWHISPER_REDACTED_AWS_KEY>");
    }
  });
});
