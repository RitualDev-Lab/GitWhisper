import { spawn } from "node:child_process";
import type { GitRunOptions, GitRunResult } from "./types.js";

export class GitError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    message: string,
    details: {
      args: string[];
      exitCode: number | null;
      stdout: string;
      stderr: string;
    },
  ) {
    super(message);
    this.name = "GitError";
    this.command = `git ${details.args.join(" ")}`;
    this.args = details.args;
    this.exitCode = details.exitCode;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
  }
}

export class NotAGitRepositoryError extends Error {
  constructor(directory: string) {
    super(`Not a git repository (or any of the parent directories): ${directory}`);
    this.name = "NotAGitRepositoryError";
  }
}

export class GitNotFoundError extends Error {
  constructor() {
    super("Git executable not found in PATH. Please install Git and try again.");
    this.name = "GitNotFoundError";
  }
}

/**
 * Executes a Git command safely without shell interpolation.
 * Always ensures arguments are passed as an array directly to the git process.
 */
export async function runGit(args: string[], options: GitRunOptions = {}): Promise<GitRunResult> {
  const { cwd = process.cwd(), timeout = 20000, signal, env } = options;

  // Prepend configuration flags to prevent Git from escaping Unicode/spaces in paths
  const fullArgs = ["-c", "core.quotepath=false", ...args];

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn("git", fullArgs, {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          ...env,
        },
      });
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return reject(new GitNotFoundError());
      }
      return reject(err);
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let isSettled = false;

    let timeoutId: NodeJS.Timeout | undefined;
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          child.kill("SIGKILL");
          reject(
            new GitError(`Git command timed out after ${timeout}ms: git ${args.join(" ")}`, {
              args,
              exitCode: null,
              stdout: Buffer.concat(stdoutChunks).toString("utf8"),
              stderr: Buffer.concat(stderrChunks).toString("utf8"),
            }),
          );
        }
      }, timeout);
    }

    const abortHandler = () => {
      if (!isSettled) {
        isSettled = true;
        child.kill("SIGKILL");
        reject(
          new GitError(`Git command was cancelled: git ${args.join(" ")}`, {
            args,
            exitCode: null,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
          }),
        );
      }
    };

    if (signal) {
      if (signal.aborted) {
        abortHandler();
        return;
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err: any) => {
      if (isSettled) return;
      isSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortHandler);

      if (err?.code === "ENOENT") {
        reject(new GitNotFoundError());
      } else {
        reject(err);
      }
    });

    child.on("close", (exitCode) => {
      if (isSettled) return;
      isSettled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortHandler);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (exitCode !== 0) {
        if (stderr.includes("not a git repository")) {
          reject(new NotAGitRepositoryError(cwd));
          return;
        }

        reject(
          new GitError(`Git command failed with exit code ${exitCode}: git ${args.join(" ")}`, {
            args,
            exitCode,
            stdout,
            stderr,
          }),
        );
        return;
      }

      resolve({ stdout, stderr, exitCode: 0 });
    });
  });
}
