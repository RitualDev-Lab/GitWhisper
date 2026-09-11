import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildChangeContext,
  buildCommitPlan,
  validateCommitPlanInvariants,
} from "../packages/core/dist/index.js";
import {
  commitStagedChanges,
  executeIsolatedGroupCommit,
  getIndexFingerprint,
  getStagedIndexEntries,
  runGit,
  syncPrimaryIndex,
} from "../packages/git/dist/index.js";

async function verifyPhase4(): Promise<void> {
  console.log("\n========================================================");
  console.log("   GitWhisper Phase 4 — Multi-Concern & Split Verification");
  console.log("========================================================\n");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-phase4-verify-"));
  console.log(`[1] Created clean temporary Git repository at:\n    ${tempDir}`);

  await runGit(["init"], { cwd: tempDir });
  await runGit(["config", "user.name", "Phase 4 Verifier"], { cwd: tempDir });
  await runGit(["config", "user.email", "verifier@gitwhisper.local"], { cwd: tempDir });

  // Root commit
  await fs.writeFile(path.join(tempDir, "README.md"), "# GitWhisper Test Repo\n");
  await runGit(["add", "README.md"], { cwd: tempDir });
  await commitStagedChanges(tempDir, { subject: "chore: initial project setup" });
  console.log("    ✓ Root commit created on default branch");

  // Prepare multi-concern staged changes
  console.log("\n[2] Staging multi-concern changes (Auth, UI, Deps, Docs)...");
  await fs.mkdir(path.join(tempDir, "src", "auth"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "src", "ui"), { recursive: true });
  await fs.mkdir(path.join(tempDir, "docs"), { recursive: true });

  await fs.writeFile(
    path.join(tempDir, "src", "auth", "session.ts"),
    "export const session = 'v1';\n",
  );
  await fs.writeFile(
    path.join(tempDir, "src", "auth", "token.ts"),
    "export const token = 'jwt';\n",
  );
  await fs.writeFile(
    path.join(tempDir, "src", "ui", "nav.tsx"),
    "export const Nav = () => null;\n",
  );
  await fs.writeFile(path.join(tempDir, "src", "ui", "theme.css"), ":root { --brand: blue; }\n");
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    '{\n  "name": "app",\n  "version": "1.0.0"\n}\n',
  );
  await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await fs.writeFile(path.join(tempDir, "docs", "auth.md"), "# Auth Documentation\n");

  await runGit(
    [
      "add",
      "src/auth/session.ts",
      "src/auth/token.ts",
      "src/ui/nav.tsx",
      "src/ui/theme.css",
      "package.json",
      "pnpm-lock.yaml",
      "docs/auth.md",
    ],
    { cwd: tempDir },
  );
  console.log("    ✓ Staged 7 files spanning 3+ independent concerns");

  // Add unstaged modification to src/auth/session.ts
  console.log("\n[3] Introducing unstaged modification and untracked sensitive files...");
  await fs.writeFile(
    path.join(tempDir, "src", "auth", "session.ts"),
    "export const session = 'v1';\n// UNSTAGED_WORKING_TREE_MODIFICATION\n",
  );
  console.log("    ✓ Unstaged edit added to src/auth/session.ts (MUST NOT BE OVERWRITTEN)");

  // Add untracked .env and scratch files
  await fs.writeFile(path.join(tempDir, ".env"), "SECRET_API_KEY=confidential_do_not_leak\n");
  await fs.writeFile(path.join(tempDir, "scratch.txt"), "temporary developer notes\n");
  console.log("    ✓ Untracked .env and scratch.txt created (MUST NEVER BE COMMITTED)");

  // Build change context & commit plan
  console.log("\n[4] Building Commit Plan using Deterministic Relationship Intelligence...");
  const context = await buildChangeContext(tempDir);
  const plan = await buildCommitPlan(tempDir, context, { minimumConfidence: 0.6 });

  console.log(`    Index Fingerprint: ${plan.indexFingerprint}`);
  console.log(`    Total Files:      ${plan.totalFiles}`);
  console.log(`    Cohesion Score:   ${(plan.cohesionScore * 100).toFixed(0)}%`);
  console.log(`    Concern Groups:   ${plan.groups.length}`);

  if (plan.groups.length < 2) {
    throw new Error(`Expected at least 2 concern groups, got ${plan.groups.length}`);
  }

  plan.groups.forEach((g, idx) => {
    console.log(`      • Group ${idx + 1} [${g.id}]: "${g.name}" (${g.files.length} files)`);
    console.log(`        Files: ${g.files.join(", ")}`);
  });

  validateCommitPlanInvariants(
    plan,
    context.files.map((f) => f.path),
  );
  console.log("    ✓ Invariants strictly validated: each staged file is in exactly one group");

  // Execute isolated splitting
  console.log("\n[5] Executing isolated multi-commit split transactions...");
  const stagedEntries = await getStagedIndexEntries(tempDir);
  const tempIndexFile = path.join(tempDir, ".git", "phase4-verify-index");

  for (let i = 0; i < plan.groups.length; i++) {
    const group = plan.groups[i];
    const subject = group.proposal
      ? `${group.proposal.type}${group.proposal.scope ? `(${group.proposal.scope})` : ""}: ${group.proposal.description}`
      : group.name;

    const res = await executeIsolatedGroupCommit(tempDir, {
      files: group.files,
      stagedEntries,
      subject,
      tempIndexFile,
    });
    console.log(
      `    [Commit ${i + 1}/${plan.groups.length}] ${res.commitHash.slice(0, 7)} — ${subject}`,
    );
  }

  await syncPrimaryIndex(tempDir, tempIndexFile);
  await fs.unlink(tempIndexFile);
  console.log("    ✓ Primary index synchronized with HEAD");

  // Rigorous verification of Zero-Data-Loss invariants
  console.log("\n[6] Verifying Zero-Data-Loss & Preservation Invariants...");

  // 1. Working-tree unstaged modification intact
  const diskSessionContent = await fs.readFile(
    path.join(tempDir, "src", "auth", "session.ts"),
    "utf8",
  );
  if (!diskSessionContent.includes("// UNSTAGED_WORKING_TREE_MODIFICATION")) {
    throw new Error("FAIL: Unstaged modification in src/auth/session.ts was lost!");
  }
  console.log("    ✓ Working-tree modification in src/auth/session.ts was PERFECTLY preserved");

  // 2. Untracked files untouched
  const envContent = await fs.readFile(path.join(tempDir, ".env"), "utf8");
  if (envContent !== "SECRET_API_KEY=confidential_do_not_leak\n") {
    throw new Error("FAIL: Untracked .env file was modified or deleted!");
  }
  console.log("    ✓ Untracked .env file was untouched");

  // 3. Git status verifies status porcelain
  const gitStatus = await runGit(["status", "--porcelain"], { cwd: tempDir });
  if (!gitStatus.stdout.includes(" M src/auth/session.ts")) {
    throw new Error(`FAIL: Expected ' M src/auth/session.ts' in status, got:\n${gitStatus.stdout}`);
  }
  if (!gitStatus.stdout.includes("?? .env")) {
    throw new Error(`FAIL: Expected '?? .env' in status, got:\n${gitStatus.stdout}`);
  }
  if (!gitStatus.stdout.includes("?? scratch.txt")) {
    throw new Error(`FAIL: Expected '?? scratch.txt' in status, got:\n${gitStatus.stdout}`);
  }
  console.log("    ✓ Git status strictly matches expected state:");
  console.log(
    gitStatus.stdout
      .trim()
      .split("\n")
      .map((l) => `        ${l}`)
      .join("\n"),
  );

  // 4. Commits in git history
  const gitLog = await runGit(["log", "--oneline", "-n", String(plan.groups.length + 1)], {
    cwd: tempDir,
  });
  console.log("\n[7] Authoritative Git Log after Split:");
  console.log(
    gitLog.stdout
      .trim()
      .split("\n")
      .map((l) => `        ${l}`)
      .join("\n"),
  );

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log("\n========================================================");
  console.log("   ✓ ALL PHASE 4 CAPABILITIES VERIFIED SUCCESSFULLY!");
  console.log("========================================================\n");
}

verifyPhase4().catch((err) => {
  console.error("\nVerification FAILED:", err);
  process.exit(1);
});
