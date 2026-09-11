import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { colors } from "./terminal.js";

/**
 * Interactive terminal editor for tweaking the proposed commit subject and body.
 */
export async function editCommitMessage(
  current: {
    subject: string;
    body?: string;
  },
  options?: { editor?: string; preferExternal?: boolean },
): Promise<{ subject: string; body?: string }> {
  if (options?.preferExternal || (options?.editor && options.editor !== "inline")) {
    const externalResult = openInExternalEditor(current, options?.editor);
    if (externalResult) {
      return externalResult;
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n ${colors.bold}Edit Commit Message${colors.reset}`);
  console.log(
    ` ${colors.dim}Press Enter without typing to keep existing text, or '-' to clear body.${colors.reset}\n`,
  );

  try {
    const newSubject = await rl.question(
      ` ${colors.bold}Subject${colors.reset} [${current.subject}]:\n > `,
    );

    const finalSubject = newSubject.trim() ? newSubject.trim() : current.subject;

    const currentBodyPrompt = current.body ? ` [${current.body.slice(0, 30)}...]` : " [none]";

    const newBody = await rl.question(
      `\n ${colors.bold}Body${colors.reset}${currentBodyPrompt}:\n > `,
    );

    let finalBody = current.body;
    if (newBody.trim() === "-") {
      finalBody = undefined;
    } else if (newBody.trim()) {
      finalBody = newBody.trim();
    }

    console.log("");
    return {
      subject: finalSubject,
      body: finalBody,
    };
  } finally {
    rl.close();
  }
}

/**
 * Opens an external editor ($EDITOR, $VISUAL, git editor, or specified editor)
 * with the draft commit message and parses the result.
 */
export function openInExternalEditor(
  current: { subject: string; body?: string },
  configuredEditor?: string,
): { subject: string; body?: string } | null {
  const editor =
    configuredEditor ||
    process.env.VISUAL ||
    process.env.EDITOR ||
    (process.platform === "win32" ? "notepad" : "nano");

  if (!editor) return null;

  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `GITWHISPER_EDITMSG_${Date.now()}.txt`);

  const initialContent = [
    current.subject,
    "",
    current.body || "",
    "",
    "# ----------------------------------------------------------------",
    "# Please enter the commit message for your changes. Lines starting",
    "# with '#' will be ignored. Leave subject empty to abort.",
    "# ----------------------------------------------------------------",
  ].join("\n");

  try {
    fs.writeFileSync(tempFile, initialContent, "utf-8");

    // Launch editor with inherited stdio
    const shell = process.platform === "win32";
    const result = spawnSync(editor, [tempFile], {
      stdio: "inherit",
      shell,
    });

    if (result.status !== 0 && result.error) {
      return null;
    }

    const modifiedContent = fs.readFileSync(tempFile, "utf-8");
    const cleanLines = modifiedContent
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => !l.startsWith("#"));

    // Find first non-empty line as subject
    let firstNonEmpty = -1;
    for (let i = 0; i < cleanLines.length; i++) {
      if (cleanLines[i]?.trim()) {
        firstNonEmpty = i;
        break;
      }
    }

    if (firstNonEmpty === -1) {
      // User cleared the file -> abort edit, retain current
      return current;
    }

    const subject = cleanLines[firstNonEmpty]?.trim() || current.subject;
    const bodyLines = cleanLines.slice(firstNonEmpty + 1);

    // Drop leading blank lines in body
    while (bodyLines.length > 0 && !bodyLines[0]?.trim()) {
      bodyLines.shift();
    }
    // Drop trailing blank lines
    while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1]?.trim()) {
      bodyLines.pop();
    }

    const body = bodyLines.length > 0 ? bodyLines.join("\n") : undefined;

    return { subject, body };
  } catch {
    return null;
  } finally {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
