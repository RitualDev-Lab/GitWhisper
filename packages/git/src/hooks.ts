import fs from "node:fs/promises";
import path from "node:path";
import { runGit } from "./executor.js";
import type { HookStatus } from "./types.js";

const HOOK_MARKER = "# Managed by GitWhisper";
const CHAIN_START = "# --- GitWhisper Managed Hook Chain ---";
const CHAIN_END = "# --- End GitWhisper Managed Hook Chain ---";

function getStandaloneScript(hookName: string): string {
  const arg = hookName === "commit-msg" ? ' "$1"' : "";
  return `#!/bin/sh
${HOOK_MARKER}

if command -v gitwhisper >/dev/null 2>&1; then
  gitwhisper hook ${hookName}${arg}
elif command -v npx >/dev/null 2>&1; then
  npx --no-install gitwhisper hook ${hookName}${arg}
fi
`;
}

function getChainSnippet(hookName: string): string {
  const arg = hookName === "commit-msg" ? ' "$1"' : "";
  return `
${CHAIN_START}
if command -v gitwhisper >/dev/null 2>&1; then
  gitwhisper hook ${hookName}${arg} || exit $?
elif command -v npx >/dev/null 2>&1; then
  npx --no-install gitwhisper hook ${hookName}${arg} || exit $?
fi
${CHAIN_END}
`;
}

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
 * Inspects status of a specific Git hook (commit-msg or pre-commit).
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
 * Safely installs any Git hook (commit-msg or pre-commit).
 * Will NOT silently overwrite existing non-GitWhisper hooks unless force is specified.
 */
export async function installHook(
  repoRoot: string,
  hookName = "commit-msg",
  options: { force?: boolean } = {},
): Promise<{ success: boolean; installed: boolean; message: string; chained?: boolean }> {
  const hooksDir = await getHooksDirectory(repoRoot);
  await fs.mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, hookName);

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
        message: `GitWhisper ${hookName} hook is already installed.`,
        chained: existingContent.includes(CHAIN_START),
      };
    }

    // Existing hook found that is not managed by GitWhisper
    if (!options.force) {
      return {
        success: false,
        installed: false,
        message: `Existing ${hookName} hook detected. GitWhisper will not overwrite it automatically. Use --force to chain GitWhisper into the existing hook.`,
      };
    }

    // Force enabled: chain GitWhisper cleanly into existing hook
    const chainedContent = `${existingContent.trimEnd()}\n${getChainSnippet(hookName)}`;
    await fs.writeFile(hookPath, chainedContent, "utf8");
    try {
      await fs.chmod(hookPath, 0o755);
    } catch {
      // ignore on systems that don't support chmod (Windows)
    }

    return {
      success: true,
      installed: true,
      message: `Chained GitWhisper into existing ${hookName} hook.`,
      chained: true,
    };
  }

  // No existing hook: install standalone script
  await fs.writeFile(hookPath, getStandaloneScript(hookName), "utf8");
  try {
    await fs.chmod(hookPath, 0o755);
  } catch {
    // ignore on systems that don't support chmod (Windows)
  }

  return {
    success: true,
    installed: true,
    message: `GitWhisper ${hookName} hook installed successfully.`,
    chained: false,
  };
}

/**
 * Uninstalls GitWhisper from a Git hook.
 */
export async function uninstallHook(
  repoRoot: string,
  hookName = "commit-msg",
): Promise<{ success: boolean; installed: boolean; message: string }> {
  const hooksDir = await getHooksDirectory(repoRoot);
  const hookPath = path.join(hooksDir, hookName);

  let content: string;
  try {
    content = await fs.readFile(hookPath, "utf8");
  } catch {
    return {
      success: true,
      installed: false,
      message: `No ${hookName} hook found.`,
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
      message: `GitWhisper hook chain removed from existing ${hookName} hook.`,
    };
  }

  if (content.includes(HOOK_MARKER)) {
    await fs.unlink(hookPath);
    return {
      success: true,
      installed: false,
      message: `GitWhisper ${hookName} hook uninstalled successfully.`,
    };
  }

  return {
    success: false,
    installed: true,
    message: `Existing ${hookName} hook is not managed by GitWhisper. Skipping uninstall to protect user hooks.`,
  };
}

/**
 * Safely installs the commit-msg hook.
 */
export async function installCommitMsgHook(
  repoRoot: string,
  options: { force?: boolean } = {},
): Promise<{ success: boolean; installed: boolean; message: string; chained?: boolean }> {
  return installHook(repoRoot, "commit-msg", options);
}

/**
 * Uninstalls GitWhisper from commit-msg hook.
 */
export async function uninstallCommitMsgHook(
  repoRoot: string,
): Promise<{ success: boolean; installed: boolean; message: string }> {
  return uninstallHook(repoRoot, "commit-msg");
}

/**
 * Safely installs the pre-commit hook (Differential Guard & Secret Sanitizer).
 */
export async function installPreCommitHook(
  repoRoot: string,
  options: { force?: boolean } = {},
): Promise<{ success: boolean; installed: boolean; message: string; chained?: boolean }> {
  return installHook(repoRoot, "pre-commit", options);
}

/**
 * Uninstalls GitWhisper from pre-commit hook.
 */
export async function uninstallPreCommitHook(
  repoRoot: string,
): Promise<{ success: boolean; installed: boolean; message: string }> {
  return uninstallHook(repoRoot, "pre-commit");
}
