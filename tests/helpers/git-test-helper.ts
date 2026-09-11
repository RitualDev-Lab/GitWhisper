import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGit } from "@gitwhisper/git";

export interface TempRepo {
  path: string;
  dir: string;
  cleanup: () => Promise<void>;
  writeFile: (relativePath: string, content: string | Buffer) => Promise<string>;
  deleteFile: (relativePath: string) => Promise<void>;
}

export async function createTempGitRepo(prefix = "gitwhisper-test-"): Promise<TempRepo> {
  const rawDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const tmpDir = await fs.realpath(rawDir);

  // Initialize git repository
  await runGit(["init", "-b", "main"], { cwd: tmpDir });
  await runGit(["config", "user.name", "GitWhisper Test"], { cwd: tmpDir });
  await runGit(["config", "user.email", "test@gitwhisper.local"], { cwd: tmpDir });
  await runGit(["config", "commit.gpgsign", "false"], { cwd: tmpDir });

  const writeFile = async (relativePath: string, content: string | Buffer): Promise<string> => {
    const fullPath = path.join(tmpDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    if (typeof content === "string") {
      await fs.writeFile(fullPath, content, "utf8");
    } else {
      await fs.writeFile(fullPath, content);
    }
    return fullPath;
  };

  const deleteFile = async (relativePath: string): Promise<void> => {
    const fullPath = path.join(tmpDir, relativePath);
    await fs.unlink(fullPath).catch(() => {});
  };

  const cleanup = async (): Promise<void> => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures on Windows file locks
    }
  };

  return {
    path: tmpDir,
    dir: tmpDir,
    cleanup,
    writeFile,
    deleteFile,
  };
}
