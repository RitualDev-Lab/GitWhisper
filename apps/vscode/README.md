# GitWhisper for Visual Studio Code

**GitWhisper** is a local-first and BYOK (Bring Your Own Key) AI-assisted Git commit intelligence tool by RitualDev. It seamlessly generates high-quality Conventional Commits directly within the VS Code Source Control (SCM) panel while strictly protecting your privacy.

---

## ✨ Features

- **1-Click Commit Message Generation**: Click the `$(sparkle)` icon directly in the SCM commit input box or title bar to generate message variants.
- **Strict Privacy Safeguards**: Automated pre-transmission secret scanning, API key redaction, and local-first execution. Your sensitive credentials never leave your machine.
- **Conventional Commits**: Deterministic type and scope classification based on staged files, repository history, and Git diff plumbing.
- **Multiple Message Variants**: Choose between Concise, Descriptive, or Detailed styles with an interactive QuickPick list.
- **Commit Decision Provenance**: Click `GitWhisper: Explain Commit Decision Provenance` to see why specific types, scopes, and descriptions were selected.
- **Pre-commit Quality Checker**: Validates your commit message against repository policy and Conventional Commit standards.
- **Timeline Intelligence**: View historical workstreams grouped by feature, issue ticket keys (e.g. `DEV-142`), and revert links.

---

## 🚀 How to Use

1. Stage your changes in Git (`git add <files>` or click `+` in the Source Control panel).
2. Open the **Source Control** view (`Ctrl+Shift+G`).
3. Click the **`✨ Generate Commit Message`** icon in the commit input box (or press `Alt+G C` / `Cmd+Alt+G C`).
4. Select your preferred variant from the QuickPick menu.
5. GitWhisper automatically populates the commit box. Click the checkmark to commit!

---

## ⚙️ Extension Settings

- `gitwhisper.provider`: Choose your AI provider (`ollama`, `openai`, `mock`). Defaults to local `ollama`.
- `gitwhisper.confirmBeforeCommit`: Require developer review before applying changes (defaults to `true`).

---

## 🛡️ License

MIT © RitualDev
