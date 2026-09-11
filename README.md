<div align="center">

# 🔮 GitWhisper

### AI-assisted Git commit intelligence grounded in your actual staged changes.
**Local-first. BYOK. Privacy-hardened. Developer-approved.**

[![CI Workflow](https://img.shields.io/badge/CI-Passing-brightgreen?style=flat-square&logo=githubactions&logoColor=white)](#)
[![Tests](https://img.shields.io/badge/Tests-304%2F304%20Passing-success?style=flat-square&logo=vitest&logoColor=white)](#)
[![Coverage](https://img.shields.io/badge/Coverage-74%25%20Verified-blue?style=flat-square)](#)
[![Quality Suite](https://img.shields.io/badge/QS%20Suite-10%2F10%20Verified-purple?style=flat-square)](#)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-SCM%20Ready-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](#)
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20Leak%20Redaction-orange?style=flat-square)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](#)

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-vs-code-extension">VS Code Extension</a> •
  <a href="#-why-gitwhisper">Why GitWhisper?</a> •
  <a href="#-core-features">Features</a> •
  <a href="#-cli-experience">CLI Demo</a> •
  <a href="#-monorepo-architecture">Architecture</a>
</p>

---

</div>

## 💡 Never Write `fix: update stuff` or `wip` Again

Most AI commit tools do something reckless: they dump your raw Git diffs onto remote servers, leaking `.env` secrets, private tokens, and unreviewed code. Then they hallucinate non-standard commit messages that make your Git history messy.

**GitWhisper is built differently:**

1. **Deterministic Truth First**: Inspects real index plumbing (`git diff --cached`), file trees, and repository history to determine the conventional `type` and `scope` before AI is ever called.
2. **Ironclad Privacy Boundary**: Built-in AST secret scanner automatically redacts API keys, JWTs, private keys, and passwords before any remote prompt is sent.
3. **Multiple Intent Variants**: Generates **Concise**, **Descriptive**, and **Detailed** variants with 1 click or keypress.
4. **Atomic Hunk Splitting**: Detects multiple distinct concerns in your staged changes and splits them into clean, independent atomic commits.
5. **Developer Remains in Control**: GitWhisper never silently commits without your explicit approval.

---

## ⚡ Quick Start

### 1. Run Instantly with NPX (No install required)
```bash
# Stage your changes
git add .

# Run GitWhisper
npx gitwhisper
```

### 2. Install Globally
```bash
npm install -g gitwhisper
# or with pnpm
pnpm add -g gitwhisper
```

Then simply type:
```bash
gitwhisper
```

---

## 🖥️ VS Code Extension: 1-Click Commit in SCM

GitWhisper embeds directly into your native VS Code Source Control (SCM) panel!

```text
┌────────────────────────────────────────────────────────┐
│ SOURCE CONTROL                                ✨ 📖 ⚙  │  <-- 1-Click Generation & Provenance
├────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────── ✨┐ │  <-- SCM Input Box Action Icon
│ │ feat(auth): refresh session tokens before timeout   │ │  <-- Auto-filled Conventional Commit!
│ └──────────────────────────────────────────────────────┘ │
│ [ ✓ Commit ]                                           │  <-- Normal native VS Code commit
│                                                        │
│ CHANGES                                                │
│  ✓ Staged Changes (2)                                  │
│    M src/auth/session.ts                               │
│    M src/auth/token.ts                                 │
└────────────────────────────────────────────────────────┘
  Status Bar: $(shield) GitWhisper: Local-Only            <-- Live Privacy Indicator
```

- **Inline Sparkle Action**: Click the `$(sparkle)` button inside the commit message box to generate messages instantly.
- **Interactive QuickPick**: Choose between Concise, Descriptive, or Detailed styles.
- **Explain Commit**: Inspect classification evidence, confidence levels, and privacy badges without leaving your editor.
- **Keyboard Shortcut**: Press `Alt+G C` (`Cmd+Alt+G C` on macOS) to generate a commit proposal anywhere.

To test the extension locally:
```bash
pnpm run build:vscode
# Press F5 in VS Code to launch the Extension Development Host!
```

---

## 🕹️ Interactive CLI Experience

```text
  GitWhisper v0.9.0  [Local-Only]  ollama (qwen2.5-coder:7b) (140ms)
 Repo: ritual-api (feature/DEV-142-session-timeout)  Staged: 2 files (+48, -12)

 Issue: DEV-142 — Refresh sessions before expiration
 Privacy: [LOCAL-ONLY] Zero external data transmission

 Variants:  [1] Concise    [2] Descriptive ●    [3] Detailed

 ┌────────────────────────────────────────────────────────────┐
 │ feat(auth): refresh session tokens before timeout (DEV-142)│
 ├────────────────────────────────────────────────────────────┤
 │ Proactively requests a refreshed access token 5 minutes    │
 │ prior to session expiry to prevent sudden user disconnects.│
 └────────────────────────────────────────────────────────────┘

 [Enter] Commit    [1-3] Variant    [e] Edit      [t] Type      [s] Scope
 [b] Breaking      [r] Regenerate   [d] Details   [p] Hunk Plan [q] Cancel
```

---

## 🚀 Key Features

### 🛡️ 1. Fail-Closed Privacy Boundary & Secret Redaction
- Evaluates configured AI providers before sending any context.
- High-entropy heuristic, known format (AWS, GitHub, Stripe, Slack, OpenAI, PEM private keys), and authorization header scanning.
- Redacted values are substituted with deterministic tokens (`[REDACTED:API_KEY_0]`).
- Untracked files, `.env` files, and unstaged modifications are strictly isolated.

### 🌿 2. Branch & Issue Tracking Intelligence
- Parses branch names (`feature/DEV-142-refresh-tokens`, `fix/issue-89`) to extract issue keys.
- Enriches commit proposals with Jira, GitHub, or Linear work-item context.
- Configurable reference formats: `(DEV-142)`, `[DEV-142]`, or footer `Fixes: #142`.

### 🧩 3. Atomic Hunk Planning & Interactive Splitting
- Detects when a developer staged multiple distinct concerns in a single session.
- Automatically groups hunks into coherent sub-plans (`gitwhisper hunks`).
- Safely applies atomic commits sequentially, preserving unstaged working tree changes.

### 📏 4. Commit Quality Checker & Git Hooks
- **CLI Checker**: Run `gitwhisper check "feat(auth): refresh tokens"` to validate subject length, casing, specificity, and conventional syntax.
- **Git Hook Integration**: Run `gitwhisper hooks install --mode warn` (or `--mode strict`) to guard your repository via `.git/hooks/commit-msg`.
- **Non-Destructive Chaining**: Never overwrites existing user hooks (e.g. Husky) — chains cleanly into them.

### ⏱️ 5. Commit Timeline & History Clustering
- Run `gitwhisper timeline` to view recent commits automatically clustered into coherent feature workstreams.
- Detects revert commits and visually links them to their original target commits.
- Read-only: Never rewrites or rebases Git history.

---

## 🧠 AI Models & Providers (Local Ollama & Cloud BYOK)

GitWhisper is built from the ground up to support **local-first privacy** as well as **Bring Your Own Key (BYOK)** cloud providers.

### 🏠 1. Local Offline Mode with Ollama (Default & Free)
By default, GitWhisper communicates with a local [Ollama](https://ollama.com) instance running on `http://localhost:11434`.
- **Default Model**: `qwen2.5-coder:7b`
- **100% Offline**: No source code, diffs, or secrets leave your machine.
- **Zero API Costs**: Run unlimited generations for free.

To use Ollama, install Ollama and pull any coding model:
```bash
# Pull the recommended default model
ollama pull qwen2.5-coder:7b

# Or pull any other model
ollama pull llama3.2
ollama pull deepseek-coder:6.7b
```

To tell GitWhisper which local model to use:
```bash
gitwhisper --provider ollama --model deepseek-coder:6.7b
```

---

### ☁️ 2. Cloud BYOK Mode (OpenAI, Groq, OpenRouter, Mistral, Together AI)
Prefer cloud intelligence? Use any OpenAI-compatible endpoint. GitWhisper's **Phase 7 Fail-Closed Redaction** automatically scans and strips secrets, passwords, and tokens before the prompt leaves your machine.

#### OpenAI
```bash
# Pass via CLI
gitwhisper --provider openai-compatible --model gpt-4o-mini --api-key sk-...

# Or set environment variable
export OPENAI_API_KEY="sk-..."
gitwhisper --provider openai-compatible --model gpt-4o-mini
```

#### Groq (Ultra-Fast Inference)
```bash
gitwhisper --provider openai-compatible \
  --base-url https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile \
  --api-key gsk_...
```

#### OpenRouter (Access Claude 3.5, Gemini, DeepSeek)
```bash
gitwhisper --provider openai-compatible \
  --base-url https://openrouter.ai/api/v1 \
  --model meta-llama/llama-3.3-70b-instruct \
  --api-key sk-or-...
```

#### LM Studio / LocalAI / vLLM (Local OpenAI Servers)
```bash
gitwhisper --provider openai-compatible \
  --base-url http://localhost:1234/v1 \
  --model local-model
```

---

### ⚙️ 3. Repository-Level Configuration (`.gitwhisper.json`)
You can lock in your preferred settings for an entire team or repository by adding a `.gitwhisper.json` file in your repository root:

```json
{
  "provider": "ollama",
  "model": "qwen2.5-coder:7b",
  "commit": {
    "maxSubjectLength": 72,
    "requireScope": false,
    "allowedTypes": ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore"]
  },
  "hooks": {
    "commitMsg": "warn"
  }
}
```

Or for an OpenAI-powered repository:
```json
{
  "provider": "openai-compatible",
  "model": "gpt-4o-mini",
  "providers": {
    "openai-compatible": {
      "baseUrl": "https://api.openai.com/v1"
    }
  }
}
```

---

### 🛡️ Deterministic Core (Always Works, Even Without an LLM)
What if Ollama is closed or your internet is down?
GitWhisper never leaves you stranded. Its deterministic engine analyzes Git tree plumbing, file paths, and monorepo structure to derive the exact Conventional Commit type (`feat`, `fix`, `docs`, `chore`, etc.) and scope (`auth`, `cli`, `vscode`). The LLM is strictly used for descriptive phrasing—it never controls commit syntax or data safety.

---

## 📦 How to Install & Upload the VS Code Extension Manually

### Option A: Install Directly into Your Local VS Code (Right Now)
1. Build the extension package:
   ```bash
   pnpm run build:vscode
   cd apps/vscode
   npx @vscode/vsce package
   ```
   *This outputs `gitwhisper-vscode-0.1.0.vsix`.*
2. Install via command line:
   ```bash
   code --install-extension apps/vscode/gitwhisper-vscode-0.1.0.vsix
   ```
   **OR via VS Code UI**:
   - Open VS Code $\rightarrow$ click the **Extensions** icon (`Ctrl+Shift+X`).
   - Click the **`...`** (Views and More Actions) menu in the top right corner of the Extensions panel.
   - Select **Install from VSIX...**
   - Choose `apps/vscode/gitwhisper-vscode-0.1.0.vsix`. Done!

### Option B: Upload Manually to the VS Code Marketplace Web Portal
You do **not** need to use the command line to publish:
1. Create a publisher account at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
2. Click **New Extension** $\rightarrow$ **Visual Studio Code**.
3. Drag and drop `gitwhisper-vscode-0.1.0.vsix`.
4. Microsoft automatically validates and publishes your extension within 5 minutes!

---

## 🛠️ CLI Command Reference

| Command | Description |
| :--- | :--- |
| `gitwhisper` | Interactive commit composer with variant selection and overrides. |
| `gitwhisper generate --dry-run` | Generates conventional proposals without committing. |
| `gitwhisper check [msg]` | Evaluates commit message quality against team policy. |
| `gitwhisper hooks [install\|status\|uninstall]` | Manages the `.git/hooks/commit-msg` quality gate. |
| `gitwhisper style` | Learns and inspects repository-specific commit conventions. |
| `gitwhisper timeline` | Clustered commit history and workstream intelligence. |
| `gitwhisper hunks` | Inspects and plans atomic hunk-level commit splitting. |

---

## 🏛️ Monorepo Architecture

```text
gitwhisper/
├── packages/
│   ├── core/           # Core engine, type/scope detection, history style, timeline
│   ├── git/            # Index plumbing, diff parsing, hooks manager, patch ops
│   ├── ai/             # Ollama, OpenAI-compatible BYOK adapters, prompt guards
│   ├── config/         # Multi-layer configuration (.gitwhisper.json) and team policy
│   └── editor/         # Reusable MyIDEAdapter and IDE command bridges
├── apps/
│   ├── cli/            # Interactive terminal application
│   └── vscode/         # Native VS Code Extension with SCM UI integration
├── scripts/
│   └── qs-test.ts      # Automated 10-step Quality Suite runner
└── .github/workflows/
    ├── ci.yml          # Multi-OS matrix CI (Ubuntu, macOS, Windows on Node 20 & 22)
    └── pr-title.yml    # Conventional Commit PR title validation
```

---

## 🧪 Testing & Verification

GitWhisper is rigorously tested with zero-mock Git plumbing tests:

```bash
# Run complete test suite (304 tests across 66 files)
pnpm test

# Run tests with coverage gates
pnpm run test:coverage

# Run the 10-step Quality Suite
pnpm run test:qs

# Run code linter & format check
pnpm run lint
pnpm run format:check

# Build all packages and the VS Code extension
pnpm run build
```

---

## 📄 License

MIT © [RitualDev](https://github.com/RitualDev)
