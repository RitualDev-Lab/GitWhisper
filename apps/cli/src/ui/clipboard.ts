import { spawn } from "node:child_process";

/**
 * Attempts to copy text to system clipboard using native platform utilities.
 * Returns true if copying succeeded, false otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform === "darwin") {
    return tryCommand("pbcopy", [], text);
  }

  if (process.platform === "win32") {
    const success = await tryCommand("clip", [], text);
    if (success) return true;
    return tryCommand("powershell", ["-NoProfile", "-Command", "Set-Clipboard", "-Value", text]);
  }

  // Linux / BSD / Unix: try wl-copy, xclip, xsel in order
  if (process.env.WAYLAND_DISPLAY) {
    const wl = await tryCommand("wl-copy", [], text);
    if (wl) return true;
  }

  const xclip = await tryCommand("xclip", ["-selection", "clipboard"], text);
  if (xclip) return true;

  return tryCommand("xsel", ["--clipboard", "--input"], text);
}

function tryCommand(cmd: string, args: string[], input = ""): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        stdio: ["pipe", "ignore", "ignore"],
        shell: false,
      });

      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));

      if (input) {
        child.stdin.write(input);
      }
      child.stdin.end();
    } catch {
      resolve(false);
    }
  });
}
