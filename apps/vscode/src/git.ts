import * as vscode from "vscode";

export interface VSCodeGitRepository {
  rootUri: vscode.Uri;
  inputBox: {
    value: string;
  };
  state: {
    HEAD?: {
      name?: string;
    };
    indexChanges: any[];
    workingTreeChanges: any[];
  };
  commit?: (message: string) => Promise<void>;
}

export interface VSCodeGitAPI {
  repositories: VSCodeGitRepository[];
  getRepository: (uri: vscode.Uri) => VSCodeGitRepository | null;
}

/**
 * Retrieves the VS Code native Git API if available.
 */
export function getVSCodeGitAPI(): VSCodeGitAPI | null {
  try {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension) {
      return null;
    }
    const exports = gitExtension.exports;
    if (typeof exports?.getAPI === "function") {
      return exports.getAPI(1) as VSCodeGitAPI;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Finds the most relevant repository for the active workspace/editor context.
 */
export function getActiveRepository(
  gitApi: VSCodeGitAPI | null,
  targetUri?: vscode.Uri,
): VSCodeGitRepository | null {
  if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
    return null;
  }

  // If a specific URI is provided (e.g. from SCM menu context)
  if (targetUri) {
    const matched = gitApi.getRepository(targetUri);
    if (matched) return matched;
  }

  // Active text editor document repo
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document?.uri) {
    const matched = gitApi.getRepository(activeEditor.document.uri);
    if (matched) return matched;
  }

  // Default to first repo in workspace
  return gitApi.repositories[0] ?? null;
}
