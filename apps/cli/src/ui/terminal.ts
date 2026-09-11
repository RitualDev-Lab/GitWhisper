import { spawn } from "node:child_process";
import readline from "node:readline";
import type { PrivacyBadge } from "@gitwhisper/ai";
import type { ChangeContext, ConfidenceLevel } from "@gitwhisper/core";

const hasColor =
  !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR !== undefined);

export const colors = {
  reset: hasColor ? "\x1b[0m" : "",
  bold: hasColor ? "\x1b[1m" : "",
  dim: hasColor ? "\x1b[2m" : "",
  italic: hasColor ? "\x1b[3m" : "",
  underline: hasColor ? "\x1b[4m" : "",
  green: hasColor ? "\x1b[32m" : "",
  yellow: hasColor ? "\x1b[33m" : "",
  blue: hasColor ? "\x1b[34m" : "",
  magenta: hasColor ? "\x1b[35m" : "",
  cyan: hasColor ? "\x1b[36m" : "",
  red: hasColor ? "\x1b[31m" : "",
  gray: hasColor ? "\x1b[90m" : "",
};

export function printHeader(): void {
  console.log(
    `\n ${colors.bold}${colors.cyan}GitWhisper${colors.reset} ${colors.yellow}⚡${colors.reset}\n`,
  );
}

export function printContextSummary(
  context: ChangeContext,
  providerName: string,
  model: string,
  privacy: PrivacyBadge,
): void {
  const pad = 14;
  console.log(
    ` ${colors.dim}${"Repository".padEnd(pad)}${colors.reset} ${colors.bold}${context.repository.name}${colors.reset}`,
  );
  console.log(
    ` ${colors.dim}${"Branch".padEnd(pad)}${colors.reset} ${context.repository.branch ?? "(initial)"}`,
  );
  console.log(` ${colors.dim}${"Provider".padEnd(pad)}${colors.reset} ${providerName}`);
  console.log(` ${colors.dim}${"Model".padEnd(pad)}${colors.reset} ${model}`);

  const privacyColor = privacy.isLocal ? colors.green : colors.yellow;
  console.log(
    ` ${colors.dim}${"Privacy".padEnd(pad)}${colors.reset} ${privacyColor}${privacy.description}${colors.reset}\n`,
  );

  console.log(` ${colors.bold}Staged changes${colors.reset}\n`);

  for (const file of context.files) {
    const statusLetter =
      file.status === "added"
        ? `${colors.green}A${colors.reset}`
        : file.status === "modified"
          ? `${colors.blue}M${colors.reset}`
          : file.status === "deleted"
            ? `${colors.red}D${colors.reset}`
            : file.status === "renamed"
              ? `${colors.magenta}R${colors.reset}`
              : `${colors.yellow}U${colors.reset}`;

    const renameStr = file.previousPath ? ` (${file.previousPath} -> ${file.path})` : "";
    console.log(`  ${statusLetter}  ${file.path}${renameStr}`);
  }

  const { filesChanged, additions, deletions } = context.stats;
  const filesLabel = filesChanged === 1 ? "1 file" : `${filesChanged} files`;
  console.log(
    `\n  ${colors.dim}${filesLabel}${colors.reset}  ${colors.green}+${additions}${colors.reset} ${colors.red}-${deletions}${colors.reset}\n`,
  );

  if (context.diffMetadata.truncated) {
    console.log(`  ${colors.yellow}⚠ ${context.diffMetadata.warning}${colors.reset}\n`);
  }
}

export function printDetectedSummary(proposal: {
  type: string;
  scope?: string;
  confidence: {
    type: ConfidenceLevel;
    scope: ConfidenceLevel;
  };
  breaking?: boolean;
}): void {
  const pad = 14;
  console.log(` ${colors.bold}Detected${colors.reset}\n`);
  console.log(
    ` ${colors.dim}${"Type".padEnd(pad)}${colors.reset} ${colors.green}${proposal.type}${colors.reset}`,
  );
  console.log(
    ` ${colors.dim}${"Scope".padEnd(pad)}${colors.reset} ${proposal.scope ? colors.cyan + proposal.scope : `${colors.dim}none`}${colors.reset}`,
  );
  console.log(
    ` ${colors.dim}${"Confidence".padEnd(pad)}${colors.reset} ${proposal.confidence.type}`,
  );
  if (proposal.breaking) {
    console.log(
      ` ${colors.dim}${"Breaking".padEnd(pad)}${colors.reset} ${colors.red}YES (!)${colors.reset}`,
    );
  }
  console.log("");
}

/**
 * Wraps text to a specified maximum width.
 */
function wrapLines(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const p of paragraphs) {
    if (!p.trim()) {
      lines.push("");
      continue;
    }

    const words = p.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxWidth) {
        currentLine += ` ${word}`;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * Draws a clean terminal box displaying the suggested commit message.
 */
export function drawCommitBox(subject: string, body?: string, width = 64): void {
  const contentWidth = width - 4; // 2 for borders, 2 for padding
  const title = " Suggested Commit ";
  const topBorder = ` ┌${title}${"─".repeat(Math.max(0, contentWidth + 2 - title.length))}┐`;
  const bottomBorder = ` └${"─".repeat(contentWidth + 2)}┘`;
  const emptyLine = ` │ ${" ".repeat(contentWidth)} │`;

  console.log(colors.cyan + topBorder + colors.reset);
  console.log(colors.cyan + emptyLine + colors.reset);

  // Subject line (bold)
  const subjectLines = wrapLines(subject, contentWidth);
  for (const line of subjectLines) {
    const padded = line.padEnd(contentWidth);
    console.log(
      ` ${colors.cyan}│${colors.reset} ${colors.bold}${padded}${colors.reset} ${colors.cyan}│${colors.reset}`,
    );
  }

  if (body?.trim()) {
    console.log(colors.cyan + emptyLine + colors.reset);
    const bodyLines = wrapLines(body.trim(), contentWidth);
    for (const line of bodyLines) {
      const padded = line.padEnd(contentWidth);
      console.log(` ${colors.cyan}│${colors.reset} ${padded} ${colors.cyan}│${colors.reset}`);
    }
  }

  console.log(colors.cyan + emptyLine + colors.reset);
  console.log(colors.cyan + bottomBorder + colors.reset);
  console.log("");
}

export type ApprovalAction =
  | "commit"
  | "type"
  | "scope"
  | "breaking"
  | "edit"
  | "regenerate"
  | "details"
  | "copy"
  | "split"
  | "cancel";

/**
 * Prompts user for approval action using single keypress (TTY) or readline.
 */
export async function promptApproval(options?: {
  suggestSplit?: boolean;
  splitCount?: number;
}): Promise<ApprovalAction> {
  console.log(` ${colors.bold}[Enter]${colors.reset} Commit`);
  if (options?.suggestSplit) {
    console.log(
      ` ${colors.bold}[p]${colors.reset}     ${colors.yellow}Plan / Split into ${options.splitCount ?? 2} commits${colors.reset}`,
    );
  }
  console.log(` ${colors.bold}[t]${colors.reset}     Type`);
  console.log(` ${colors.bold}[s]${colors.reset}     Scope`);
  console.log(` ${colors.bold}[b]${colors.reset}     Breaking`);
  console.log(` ${colors.bold}[e]${colors.reset}     Edit`);
  console.log(` ${colors.bold}[r]${colors.reset}     Regenerate`);
  console.log(` ${colors.bold}[d]${colors.reset}     Details`);
  console.log(` ${colors.bold}[c]${colors.reset}     Copy`);
  console.log(` ${colors.bold}[q]${colors.reset}     Cancel\n`);

  if (!process.stdin.isTTY) {
    // Non-interactive fallback (reading from pipe or script)
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question("> ", (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        if (a === "p" && options?.suggestSplit) return resolve("split");
        if (a === "t") return resolve("type");
        if (a === "s") return resolve("scope");
        if (a === "b") return resolve("breaking");
        if (a === "e") return resolve("edit");
        if (a === "r") return resolve("regenerate");
        if (a === "d") return resolve("details");
        if (a === "c") return resolve("copy");
        if (a === "q") return resolve("cancel");
        return resolve("commit");
      });
    });
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (str: string, key: readline.Key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      const name = (key.name || "").toLowerCase();
      if (name === "return" || name === "enter") {
        cleanup();
        resolve("commit");
      } else if (name === "p" && options?.suggestSplit) {
        cleanup();
        resolve("split");
      } else if (name === "t") {
        cleanup();
        resolve("type");
      } else if (name === "s") {
        cleanup();
        resolve("scope");
      } else if (name === "b") {
        cleanup();
        resolve("breaking");
      } else if (name === "e") {
        cleanup();
        resolve("edit");
      } else if (name === "r") {
        cleanup();
        resolve("regenerate");
      } else if (name === "d") {
        cleanup();
        resolve("details");
      } else if (name === "c") {
        cleanup();
        resolve("copy");
      } else if (name === "q" || name === "escape") {
        cleanup();
        resolve("cancel");
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
    };

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * Copies the commit message to the system clipboard using OS clipboard utilities.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let cmd: string;
    let args: string[] = [];

    if (process.platform === "win32") {
      cmd = "clip";
    } else if (process.platform === "darwin") {
      cmd = "pbcopy";
    } else {
      cmd = "xclip";
      args = ["-selection", "clipboard"];
    }

    try {
      const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"], shell: false });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
      child.stdin.write(text);
      child.stdin.end();
    } catch {
      resolve(false);
    }
  });
}
