import { loadConfig } from "@gitwhisper/config";
import {
  findRepository,
  getHookStatus,
  installCommitMsgHook,
  uninstallCommitMsgHook,
} from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface HooksOptions {
  force?: boolean;
  mode?: "off" | "warn" | "strict";
  json?: boolean;
}

export async function runHooks(action = "status", options: HooksOptions = {}): Promise<void> {
  const repoRoot = await findRepository();
  if (!repoRoot) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "NOT_A_GIT_REPOSITORY",
              message: "Not inside a Git repository.",
            },
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    process.exit(1);
  }

  const config = await loadConfig({}, repoRoot);
  const configuredMode = config.hooks.commitMsg;

  if (action === "install") {
    const res = await installCommitMsgHook(repoRoot, { force: options.force });
    if (options.json) {
      console.log(JSON.stringify({ ...res, mode: options.mode ?? configuredMode }, null, 2));
      process.exit(res.success ? 0 : 1);
    }

    printHeader();
    if (res.success) {
      console.log(` ${colors.green}✓ ${res.message}${colors.reset}`);
      console.log(
        `   ${colors.dim}Mode:${colors.reset} ${colors.cyan}${options.mode ?? configuredMode}${colors.reset}\n`,
      );
      process.exit(0);
    } else {
      console.error(` ${colors.yellow}! ${res.message}${colors.reset}\n`);
      process.exit(1);
    }
  }

  if (action === "uninstall") {
    const res = await uninstallCommitMsgHook(repoRoot);
    if (options.json) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.success ? 0 : 1);
    }

    printHeader();
    if (res.success) {
      console.log(` ${colors.green}✓ ${res.message}${colors.reset}\n`);
      process.exit(0);
    } else {
      console.error(` ${colors.yellow}! ${res.message}${colors.reset}\n`);
      process.exit(1);
    }
  }

  // Action: status (default)
  const status = await getHookStatus(repoRoot, "commit-msg");
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ...status,
          mode: configuredMode,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  printHeader();
  console.log(` ${colors.bold}Git Hooks Status:${colors.reset}\n`);
  const statusColor = status.installed ? colors.green : colors.dim;
  const statusText = status.installed ? "Installed" : "Not Installed";
  console.log(
    `   ${colors.dim}commit-msg:${colors.reset}       ${statusColor}${statusText}${colors.reset}`,
  );
  console.log(
    `   ${colors.dim}GitWhisper managed:${colors.reset} ${status.isGitWhisperManaged ? `${colors.green}Yes${colors.reset}` : `${colors.dim}No${colors.reset}`}`,
  );
  console.log(
    `   ${colors.dim}Active policy mode:${colors.reset} ${colors.cyan}${configuredMode}${colors.reset}`,
  );
  console.log(
    `   ${colors.dim}Hook file path:${colors.reset}     ${colors.dim}${status.hookPath}${colors.reset}\n`,
  );

  if (!status.installed) {
    console.log(
      `   ${colors.dim}Run ${colors.bold}gitwhisper hooks install${colors.dim} to enable commit quality checks.${colors.reset}\n`,
    );
  }
}
