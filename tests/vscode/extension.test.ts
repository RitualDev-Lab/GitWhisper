import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

vi.mock("vscode", () => {
  return {
    extensions: {
      getExtension: vi.fn(),
    },
    window: {
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showQuickPick: vi.fn(),
      createStatusBarItem: vi.fn(() => ({
        show: vi.fn(),
        hide: vi.fn(),
      })),
    },
    workspace: {
      workspaceFolders: [],
    },
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(),
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
  };
});

import { formatVariantsForQuickPick } from "@gitwhisper/editor";
import { getActiveRepository, type VSCodeGitAPI } from "../../apps/vscode/src/git.js";

describe("VS Code Extension (@gitwhisper/vscode)", () => {
  const extensionDir = path.resolve(__dirname, "../../apps/vscode");

  beforeAll(async () => {
    const bundlePath = path.join(extensionDir, "dist/extension.js");
    try {
      await fs.stat(bundlePath);
    } catch {
      const { execSync } = await import("node:child_process");
      execSync("node esbuild.mjs", { cwd: extensionDir, stdio: "pipe" });
    }
  });

  it("declares standard SCM title bar and input box contributes menus in package.json", async () => {
    const pkgRaw = await fs.readFile(path.join(extensionDir, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);

    expect(pkg.name).toBe("gitwhisper-vscode");
    expect(pkg.publisher).toBe("ritualdev");
    expect(pkg.main).toBe("./dist/extension.js");

    const commands = pkg.contributes.commands.map((c: any) => c.command);
    expect(commands).toContain("gitwhisper.generateCommit");
    expect(commands).toContain("gitwhisper.explainCommit");
    expect(commands).toContain("gitwhisper.checkQuality");
    expect(commands).toContain("gitwhisper.showTimeline");

    // SCM menus
    const scmTitleCommands = pkg.contributes.menus["scm/title"].map((m: any) => m.command);
    expect(scmTitleCommands).toContain("gitwhisper.generateCommit");
    expect(scmTitleCommands).toContain("gitwhisper.explainCommit");

    const scmInputBoxCommands = pkg.contributes.menus["scm/inputBox"].map((m: any) => m.command);
    expect(scmInputBoxCommands).toContain("gitwhisper.generateCommit");
  });

  it("produces a valid bundled CommonJS extension artifact", async () => {
    const bundlePath = path.join(extensionDir, "dist/extension.js");
    const stat = await fs.stat(bundlePath);
    expect(stat.size).toBeGreaterThan(50 * 1024); // at least 50kb bundled

    const bundleContent = await fs.readFile(bundlePath, "utf8");
    expect(bundleContent).toContain("gitwhisper.generateCommit");
    expect(bundleContent).toContain("gitwhisper.explainCommit");
  });

  it("transforms generated variants into VS Code QuickPick items", () => {
    const items = formatVariantsForQuickPick([
      {
        id: "concise",
        subject: "feat(auth): refresh token",
        description: "Concise summary",
      },
      {
        id: "descriptive",
        subject: "feat(auth): refresh token before expiration timeout",
        body: "Refreshes session token automatically 5 minutes prior to expiry.",
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].label).toBe("feat(auth): refresh token");
    expect(items[0].description).toBe("(concise)");
    expect(items[1].label).toBe("feat(auth): refresh token before expiration timeout");
    expect(items[1].detail).toContain("Refreshes session token");
  });

  it("safely resolves active git repository from mock VS Code Git API", () => {
    const mockRepo1: any = {
      rootUri: { fsPath: "/workspace/repo-1" },
      inputBox: { value: "" },
      state: { indexChanges: [] },
    };

    const mockRepo2: any = {
      rootUri: { fsPath: "/workspace/repo-2" },
      inputBox: { value: "" },
      state: { indexChanges: [{ uri: { fsPath: "/workspace/repo-2/file.ts" } }] },
    };

    const mockGitApi: VSCodeGitAPI = {
      repositories: [mockRepo1, mockRepo2],
      getRepository: (uri: any) => {
        if (uri.fsPath.includes("repo-2")) return mockRepo2;
        return mockRepo1;
      },
    };

    // 1. With specific target uri
    const target = getActiveRepository(mockGitApi, { fsPath: "/workspace/repo-2/file.ts" } as any);
    expect(target).toBe(mockRepo2);

    // 2. Default fallback to first repository
    const fallback = getActiveRepository(mockGitApi);
    expect(fallback).toBe(mockRepo1);

    // 3. Null handling
    expect(getActiveRepository(null)).toBeNull();
  });
});
