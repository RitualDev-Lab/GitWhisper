import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliEntry = path.resolve(process.cwd(), "apps/cli/dist/index.js");

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function main() {
  console.log("=== GitWhisper Phases 9-11 End-to-End Verification ===\n");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-phase9-11-verify-"));
  console.log(`[1/7] Initializing sandbox repository at: ${tmpDir}`);
  await runGit(["init", "-b", "main"], tmpDir);
  await runGit(["config", "user.name", "GitWhisper Verifier"], tmpDir);
  await runGit(["config", "user.email", "verifier@gitwhisper.local"], tmpDir);
  await runGit(["config", "commit.gpgsign", "false"], tmpDir);

  // Configure team commit policy
  console.log("[2/7] Creating team configuration .gitwhisper.json");
  const teamConfig = {
    commit: {
      allowedTypes: ["feat", "fix", "docs", "test", "refactor"],
      scopes: ["core", "auth", "api", "ui"],
      strictScopes: true,
      maxSubjectLength: 65,
    },
    hooks: {
      commitMsg: "warn",
    },
  };
  await fs.writeFile(
    path.join(tmpDir, ".gitwhisper.json"),
    JSON.stringify(teamConfig, null, 2),
    "utf8",
  );

  // Stage changes and run gitwhisper check
  console.log("[3/7] Staging changes and verifying gitwhisper check");
  const srcFile = path.join(tmpDir, "auth.ts");
  await fs.writeFile(srcFile, "export function verifySession() { return true; }", "utf8");
  await runGit(["add", "."], tmpDir);

  // Check valid commit message
  const validCheck = await execFileAsync(
    "node",
    [cliEntry, "check", "-m", "feat(auth): add session verification function", "--json"],
    { cwd: tmpDir },
  );
  const validRes = JSON.parse(validCheck.stdout);
  if (!validRes.valid || validRes.rating !== "excellent") {
    throw new Error(`Expected valid excellent rating, got: ${JSON.stringify(validRes)}`);
  }
  console.log(`  ✓ Valid message check passed: rating=${validRes.rating}, score=${validRes.score}`);

  // Check vague commit description in strict mode
  try {
    await execFileAsync(
      "node",
      [cliEntry, "check", "-m", "feat(auth): update stuff", "--strict", "--json"],
      { cwd: tmpDir },
    );
    throw new Error("Expected strict check to reject vague description");
  } catch (err: any) {
    if (err.code !== 1) throw err;
    const res = JSON.parse(err.stdout);
    if (!res.issues.some((i: any) => i.code === "VAGUE_DESCRIPTION")) {
      throw new Error(`Expected VAGUE_DESCRIPTION issue, got: ${JSON.stringify(res.issues)}`);
    }
    console.log("  ✓ Strict check correctly rejected vague description: 'update stuff'");
  }

  // Commit valid change to history and inspect HEAD
  console.log("[4/7] Committing changes and reviewing historical commit (HEAD)");
  await runGit(
    [
      "commit",
      "-m",
      "feat(auth): add session verification function\n\nValidates active user sessions.",
    ],
    tmpDir,
  );

  const headCheck = await execFileAsync("node", [cliEntry, "check", "HEAD", "--json"], {
    cwd: tmpDir,
  });
  const headRes = JSON.parse(headCheck.stdout);
  if (!headRes.valid) {
    throw new Error(`Expected HEAD check to be valid, got: ${JSON.stringify(headRes)}`);
  }
  console.log(`  ✓ Historical commit review on HEAD passed: score=${headRes.score}`);

  // Git hooks management: install and status
  console.log("[5/7] Installing commit-msg Git hook via CLI");
  const installOutput = await execFileAsync("node", [cliEntry, "hooks", "install", "--json"], {
    cwd: tmpDir,
  });
  const installRes = JSON.parse(installOutput.stdout);
  if (!installRes.installed) {
    throw new Error(`Hook install failed: ${JSON.stringify(installRes)}`);
  }

  const statusOutput = await execFileAsync("node", [cliEntry, "hooks", "status", "--json"], {
    cwd: tmpDir,
  });
  const statusRes = JSON.parse(statusOutput.stdout);
  if (!statusRes.installed || !statusRes.managedByGitWhisper) {
    throw new Error(`Hook status failed: ${JSON.stringify(statusRes)}`);
  }
  console.log("  ✓ Git hook installed and verified active");

  // Hook execution: test secret blocking
  console.log("[6/7] Testing hook execution & secret leakage block");
  const msgPath = path.join(tmpDir, "COMMIT_TEST_MSG");
  const syntheticGhp = ["ghp", "123456789012345678901234567890123456"].join("_");
  await fs.writeFile(msgPath, `fix(auth): set secret ${syntheticGhp}`, "utf8");

  try {
    await execFileAsync("node", [cliEntry, "hook", "commit-msg", msgPath], { cwd: tmpDir });
    throw new Error("Expected hook to block secret in commit message");
  } catch (err: any) {
    if (err.code !== 1) throw err;
    if (!err.stderr.includes("SECRET_IN_COMMIT_MESSAGE") || !err.stderr.includes("BLOCKED")) {
      throw new Error(
        `Expected SECRET_IN_COMMIT_MESSAGE and BLOCKED in stderr, got: ${err.stderr}`,
      );
    }
    console.log("  ✓ Hook blocked commit containing secret token even in warn mode");
  }

  // Hook uninstall
  console.log("[7/7] Uninstalling Git hook");
  const uninstallOutput = await execFileAsync("node", [cliEntry, "hooks", "uninstall", "--json"], {
    cwd: tmpDir,
  });
  const uninstallRes = JSON.parse(uninstallOutput.stdout);
  if (uninstallRes.installed) {
    throw new Error("Expected hook to be uninstalled");
  }
  console.log("  ✓ Git hook uninstalled cleanly");

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  console.log("\n=== All Phases 9-11 Verification Steps Succeeded! ===");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
