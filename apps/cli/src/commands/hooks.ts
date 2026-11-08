import { loadConfig } from "@gitwhisper/config";
import {
  findRepository,
  getHookStatus,
  installCommitMsgHook,
  installPreCommitHook,
  uninstallCommitMsgHook,
  uninstallPreCommitHook,
} from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface HooksOptions {
  force?: boolean;
  mode?: "off" | "warn" | "strict";
  json?: boolean;
  hook?: "commit-msg" | "pre-commit" | "all";
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
  const targetHook = options.hook ?? "commit-msg";

  if (action === "install") {
    let res: { success: boolean; installed: boolean; message: string; chained?: boolean };

    if (targetHook === "pre-commit") {
      res = await installPreCommitHook(repoRoot, { force: options.force });
    } else if (targetHook === "all") {
      const res1 = await installCommitMsgHook(repoRoot, { force: options.force });
      const res2 = await installPreCommitHook(repoRoot, { force: options.force });
      res = {
        success: res1.success && res2.success,
        installed: res1.installed && res2.installed,
        message: `${res1.message} | ${res2.message}`,
        chained: res1.chained || res2.chained,
      };
    } else {
      res = await installCommitMsgHook(repoRoot, { force: options.force });
    }

    const activeMode =
      targetHook === "pre-commit"
        ? (options.mode ?? config.hooks.preCommit)
        : (options.mode ?? config.hooks.commitMsg);

    if (options.json) {
      console.log(JSON.stringify({ ...res, hook: targetHook, mode: activeMode }, null, 2));
      process.exit(res.success ? 0 : 1);
    }

    printHeader();
    if (res.success) {
      console.log(` ${colors.green}✓ ${res.message}${colors.reset}`);
      console.log(
        `   ${colors.dim}Mode:${colors.reset} ${colors.cyan}${activeMode}${colors.reset}\n`,
      );
      process.exit(0);
    } else {
      console.error(` ${colors.yellow}! ${res.message}${colors.reset}\n`);
      process.exit(1);
    }
  }

  if (action === "uninstall") {
    let res: { success: boolean; installed: boolean; message: string };

    if (targetHook === "pre-commit") {
      res = await uninstallPreCommitHook(repoRoot);
    } else if (targetHook === "all") {
      const res1 = await uninstallCommitMsgHook(repoRoot);
      const res2 = await uninstallPreCommitHook(repoRoot);
      res = {
        success: res1.success && res2.success,
        installed: res1.installed || res2.installed,
        message: `${res1.message} | ${res2.message}`,
      };
    } else {
      res = await uninstallCommitMsgHook(repoRoot);
    }

    if (options.json) {
      console.log(JSON.stringify({ ...res, hook: targetHook }, null, 2));
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
  const commitStatus = await getHookStatus(repoRoot, "commit-msg");
  const preCommitStatus = await getHookStatus(repoRoot, "pre-commit");

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ...commitStatus,
          mode: config.hooks.commitMsg,
          commitMsg: {
            ...commitStatus,
            mode: config.hooks.commitMsg,
          },
          preCommit: {
            ...preCommitStatus,
            mode: config.hooks.preCommit,
          },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  printHeader();
  console.log(` ${colors.bold}Git Hooks Status:${colors.reset}\n`);

  const commitStatusColor = commitStatus.installed ? colors.green : colors.dim;
  const commitStatusText = commitStatus.installed ? "Installed" : "Not Installed";
  console.log(
    `   ${colors.dim}commit-msg:${colors.reset}       ${commitStatusColor}${commitStatusText}${colors.reset}`,
  );
  console.log(
    `   ${colors.dim}Policy mode:${colors.reset}      ${colors.cyan}${config.hooks.commitMsg}${colors.reset}`,
  );

  const preCommitColor = preCommitStatus.installed ? colors.green : colors.dim;
  const preCommitText = preCommitStatus.installed ? "Installed" : "Not Installed";
  console.log(
    `   ${colors.dim}pre-commit:${colors.reset}       ${preCommitColor}${preCommitText}${colors.reset} (AST Differential Guard)`,
  );
  console.log(
    `   ${colors.dim}Guard mode:${colors.reset}       ${colors.cyan}${config.hooks.preCommit}${colors.reset}\n`,
  );

  if (!commitStatus.installed && !preCommitStatus.installed) {
    console.log(
      `   ${colors.dim}Run ${colors.bold}gitwhisper hooks install${colors.dim} to enable commit quality checks.${colors.reset}\n`,
    );
  }
}
