import fs from "node:fs/promises";
import path from "node:path";
import { runGit } from "./executor.js";
import type { HookStatus } from "./types.js";

const HOOK_MARKER = "# Managed by GitWhisper";
const CHAIN_START = "# --- GitWhisper Managed Hook Chain ---";
const CHAIN_END = "# --- End GitWhisper Managed Hook Chain ---";

const STANDALONE_HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}

if command -v gitwhisper >/dev/null 2>&1; then
  gitwhisper hook commit-msg "$1"
elif command -v npx >/dev/null 2>&1; then
  npx --no-install gitwhisper hook commit-msg "$1"
fi
`;

const CHAIN_HOOK_SNIPPET = `
${CHAIN_START}
if command -v gitwhisper >/dev/null 2>&1; then
  gitwhisper hook commit-msg "$1" || exit $?
elif command -v npx >/dev/null 2>&1; then
  npx --no-install gitwhisper hook commit-msg "$1" || exit $?
fi
${CHAIN_END}
`;

/**
 * Resolves the Git hooks directory for a repository.
 */
export async function getHooksDirectory(repoRoot: string): Promise<string> {
  try {
    const res = await runGit(["rev-parse", "--git-path", "hooks"], { cwd: repoRoot });
    const trimmed = res.stdout.trim();
    if (path.isAbsolute(trimmed)) {
      return trimmed;
    }
    return path.resolve(repoRoot, trimmed);
  } catch {
    return path.join(repoRoot, ".git", "hooks");
  }
}

/**
 * Inspects status of a specific Git hook (default commit-msg).
 */
export async function getHookStatus(
  repoRoot: string,
  hookName = "commit-msg",
): Promise<HookStatus> {
  const hooksDir = await getHooksDirectory(repoRoot);
  const hookPath = path.join(hooksDir, hookName);

  try {
    const content = await fs.readFile(hookPath, "utf8");
    const isGitWhisperManaged = content.includes(HOOK_MARKER) || content.includes(CHAIN_START);
    const isChained = content.includes(CHAIN_START);
    return {
      hookName,
      installed: true,
      isGitWhisperManaged,
      managedByGitWhisper: isGitWhisperManaged,
      isExecutable: true,
      isChained,
      hookPath,
    };
  } catch {
    return {
      hookName,
      installed: false,
      isGitWhisperManaged: false,
      managedByGitWhisper: false,
      isExecutable: false,
      isChained: false,
      hookPath,
    };
  }
}

/**
 * Safely installs the commit-msg hook.
 * Will NOT silently overwrite existing non-GitWhisper hooks unless force is specified.
 */
export async function installCommitMsgHook(
  repoRoot: string,
  options: { force?: boolean } = {},
): Promise<{ success: boolean; installed: boolean; message: string; chained?: boolean }> {
  const hooksDir = await getHooksDirectory(repoRoot);
  await fs.mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, "commit-msg");

  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(hookPath, "utf8");
  } catch {
    // File does not exist
  }

  if (existingContent !== null) {
    if (existingContent.includes(HOOK_MARKER) || existingContent.includes(CHAIN_START)) {
      return {
        success: true,
        installed: true,
        message: "GitWhisper commit-msg hook is already installed.",
        chained: existingContent.includes(CHAIN_START),
      };
    }

    // Existing hook found that is not managed by GitWhisper
    if (!options.force) {
      return {
        success: false,
        installed: false,
        message:
          "Existing commit-msg hook detected. GitWhisper will not overwrite it automatically. Use --force to chain GitWhisper into the existing hook.",
      };
    }

    // Force enabled: chain GitWhisper cleanly into existing hook
    const chainedContent = `${existingContent.trimEnd()}\n${CHAIN_HOOK_SNIPPET}`;
    await fs.writeFile(hookPath, chainedContent, "utf8");
    try {
      await fs.chmod(hookPath, 0o755);
    } catch {
      // ignore on systems that don't support chmod (Windows)
    }

    return {
      success: true,
      installed: true,
      message: "Chained GitWhisper into existing commit-msg hook.",
      chained: true,
    };
  }

  // No existing hook: install standalone script
  await fs.writeFile(hookPath, STANDALONE_HOOK_SCRIPT, "utf8");
  try {
    await fs.chmod(hookPath, 0o755);
  } catch {
    // ignore on systems that don't support chmod (Windows)
  }

  return {
    success: true,
    installed: true,
    message: "GitWhisper commit-msg hook installed successfully.",
    chained: false,
  };
}

/**
 * Uninstalls GitWhisper from commit-msg hook.
 * If hook was chained, removes only the GitWhisper chain.
 * If hook was foreign, leaves it untouched.
 */
export async function uninstallCommitMsgHook(
  repoRoot: string,
): Promise<{ success: boolean; installed: boolean; message: string }> {
  const hooksDir = await getHooksDirectory(repoRoot);
  const hookPath = path.join(hooksDir, "commit-msg");

  let content: string;
  try {
    content = await fs.readFile(hookPath, "utf8");
  } catch {
    return {
      success: true,
      installed: false,
      message: "No commit-msg hook found.",
    };
  }

  if (content.includes(CHAIN_START) && content.includes(CHAIN_END)) {
    // Strip chained block
    const startIndex = content.indexOf(CHAIN_START);
    const endIndex = content.indexOf(CHAIN_END) + CHAIN_END.length;
    const before = content.slice(0, startIndex).trimEnd();
    const after = content.slice(endIndex).trimStart();
    const restored = before + (after ? `\n\n${after}` : "\n");
    await fs.writeFile(hookPath, restored, "utf8");
    return {
      success: true,
      installed: false,
      message: "GitWhisper hook chain removed from existing commit-msg hook.",
    };
  }

  if (content.includes(HOOK_MARKER)) {
    await fs.unlink(hookPath);
    return {
      success: true,
      installed: false,
      message: "GitWhisper commit-msg hook uninstalled successfully.",
    };
  }

  return {
    success: false,
    installed: true,
    message:
      "Existing commit-msg hook is not managed by GitWhisper. Skipping uninstall to protect user hooks.",
  };
}
