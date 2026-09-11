import { MyIDEAdapter, formatVariantsForQuickPick } from "@gitwhisper/editor";
import { getCommitTimeline } from "@gitwhisper/core";
import * as vscode from "vscode";
import { getActiveRepository, getVSCodeGitAPI } from "./git.js";

const adapters = new Map<string, MyIDEAdapter>();

function getAdapter(repoRoot: string): MyIDEAdapter {
  let adapter = adapters.get(repoRoot);
  if (!adapter) {
    adapter = new MyIDEAdapter({
      repositoryRoot: repoRoot,
      editorName: "VSCode-GitWhisper",
    });
    adapters.set(repoRoot, adapter);
  }
  return adapter;
}

export function activate(context: vscode.ExtensionContext) {
  const gitApi = getVSCodeGitAPI();

  // 1. Status Bar Item for Privacy & Model Badge
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.name = "GitWhisper Status";
  statusBarItem.text = "$(shield) GitWhisper: Local-Only";
  statusBarItem.tooltip =
    "GitWhisper — AI Conventional Commit Intelligence\nPrivacy: Local-Only / Redacted\nClick to generate commit message";
  statusBarItem.command = "gitwhisper.generateCommit";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Helper to resolve the active repo root and SCM repo
  function resolveActiveContext(targetUri?: vscode.Uri) {
    const repo = getActiveRepository(gitApi, targetUri);
    const repoRoot = repo?.rootUri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return { repo, repoRoot };
  }

  // 2. Command: Generate Commit Message
  const generateCommand = vscode.commands.registerCommand(
    "gitwhisper.generateCommit",
    async (sourceControlUri?: vscode.Uri) => {
      const { repo, repoRoot } = resolveActiveContext(sourceControlUri);
      if (!repoRoot) {
        vscode.window.showErrorMessage("GitWhisper: No active workspace or Git repository found.");
        return;
      }

      const adapter = getAdapter(repoRoot);

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "GitWhisper: Analyzing staged changes...",
            cancellable: false,
          },
          async () => adapter.generateCommitMessage(),
        );

        if (!result.success || !result.data) {
          const code = result.error?.code;
          if (code === "EMPTY_STAGING_AREA") {
            vscode.window.showWarningMessage(
              "GitWhisper: No staged changes found. Please stage files using 'git add' or the SCM panel (+).",
            );
            return;
          }
          vscode.window.showErrorMessage(
            `GitWhisper Error: ${result.error?.message || "Failed to generate commit proposal."}`,
          );
          return;
        }

        // Update status bar with actual privacy badge from result
        if (result.data.privacy?.badge) {
          statusBarItem.text = `$(shield) GitWhisper: ${result.data.privacy.badge.replace(/[\[\]]/g, "")}`;
        }

        const quickPickItems = formatVariantsForQuickPick(result.data.variants);

        const selected = await vscode.window.showQuickPick(quickPickItems, {
          title: "GitWhisper — Select Conventional Commit Variant",
          placeHolder: "Choose a commit message variant to insert into SCM input box",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (selected) {
          const chosenVariant = result.data.variants.find((v) => v.id === selected.variantId);
          const fullMessage =
            chosenVariant?.body && chosenVariant.body.trim().length > 0
              ? `${chosenVariant.subject}\n\n${chosenVariant.body}`
              : selected.label;

          if (repo) {
            repo.inputBox.value = fullMessage;
            vscode.commands.executeCommand("workbench.view.scm");
          } else {
            // Fallback: Copy to clipboard if SCM API is unavailable
            await vscode.env.clipboard.writeText(fullMessage);
            vscode.window.showInformationMessage("GitWhisper: Commit message copied to clipboard!");
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`GitWhisper Error: ${err?.message || String(err)}`);
      }
    },
  );

  // 3. Command: Explain Commit Decision Provenance
  const explainCommand = vscode.commands.registerCommand(
    "gitwhisper.explainCommit",
    async (sourceControlUri?: vscode.Uri) => {
      const { repoRoot } = resolveActiveContext(sourceControlUri);
      if (!repoRoot) {
        vscode.window.showErrorMessage("GitWhisper: No active Git repository found.");
        return;
      }

      const adapter = getAdapter(repoRoot);

      const explanation = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "GitWhisper: Evaluating commit decision evidence...",
          cancellable: false,
        },
        async () => adapter.explainCommit(),
      );

      if (!explanation.success || !explanation.data) {
        vscode.window.showErrorMessage(
          `GitWhisper: ${explanation.error?.message || "Could not explain staged changes."}`,
        );
        return;
      }

      const { classification, stats, filesCount, privacyBadge, reasons } = explanation.data;

      const details = [
        `• Type: ${classification.type} (Confidence: ${classification.confidence})`,
        `• Scope: ${classification.scope || "none"}`,
        `• Privacy Boundary: ${privacyBadge}`,
        `• Staged Changes: ${filesCount} file(s) (+${stats.additions} / -${stats.deletions})`,
        "",
        "Classification Evidence:",
        ...reasons.map((r) => `  - ${r}`),
      ].join("\n");

      vscode.window.showInformationMessage(`GitWhisper Decision Provenance:\n\n${details}`, {
        modal: true,
      });
    },
  );

  // 4. Command: Check Staged Commit Quality
  const checkQualityCommand = vscode.commands.registerCommand(
    "gitwhisper.checkQuality",
    async (sourceControlUri?: vscode.Uri) => {
      const { repo, repoRoot } = resolveActiveContext(sourceControlUri);
      if (!repoRoot) {
        vscode.window.showErrorMessage("GitWhisper: No active Git repository found.");
        return;
      }

      const currentMessage = repo?.inputBox?.value?.trim();
      let messageToCheck = currentMessage;

      if (!messageToCheck) {
        messageToCheck = await vscode.window.showInputBox({
          title: "GitWhisper: Check Commit Quality",
          prompt: "Enter the commit message to validate against team policy",
          placeHolder: "feat(auth): refresh user session tokens",
        });
      }

      if (!messageToCheck) return;

      const adapter = getAdapter(repoRoot);
      const result = await adapter.checkMessage(messageToCheck);

      if (result.success && result.data) {
        if (result.data.valid) {
          vscode.window.showInformationMessage(
            `✓ GitWhisper Quality Check Passed: "${messageToCheck}" conforms to Conventional Commits and team policy.`,
          );
        } else {
          const reasons = (result.data.diagnostics || [])
            .map((d: any) => `• [${d.rule}] ${d.message}`)
            .join("\n");
          vscode.window.showWarningMessage(
            `GitWhisper Quality Warnings for "${messageToCheck}":\n${reasons}`,
            { modal: true },
          );
        }
      } else {
        vscode.window.showErrorMessage(`GitWhisper Quality Check Error: ${result.error?.message}`);
      }
    },
  );

  // 5. Command: View Commit Timeline & Historical Workstreams
  const showTimelineCommand = vscode.commands.registerCommand(
    "gitwhisper.showTimeline",
    async (sourceControlUri?: vscode.Uri) => {
      const { repoRoot } = resolveActiveContext(sourceControlUri);
      if (!repoRoot) {
        vscode.window.showErrorMessage("GitWhisper: No active Git repository found.");
        return;
      }

      try {
        const timeline = await getCommitTimeline(repoRoot, { limit: 30 });
        if (timeline.workstreams.length === 0) {
          vscode.window.showInformationMessage(
            "GitWhisper Timeline: No clustered workstreams found in recent history.",
          );
          return;
        }

        const items: vscode.QuickPickItem[] = [];
        for (const stream of timeline.workstreams) {
          items.push({
            label: `$(git-branch) ${stream.name}`,
            description: `(${stream.commits.length} commits, confidence: ${stream.confidence})`,
            detail: stream.theme,
          });
        }

        vscode.window.showQuickPick(items, {
          title: `GitWhisper Timeline: ${timeline.summary.totalCommits} Commits, ${timeline.workstreams.length} Clustered Workstreams`,
          placeHolder: "Historical workstreams clustered by scope, issue keys & reverts",
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`GitWhisper Timeline Error: ${err?.message || String(err)}`);
      }
    },
  );

  context.subscriptions.push(
    generateCommand,
    explainCommand,
    checkQualityCommand,
    showTimelineCommand,
  );
}

export function deactivate() {
  adapters.clear();
}
