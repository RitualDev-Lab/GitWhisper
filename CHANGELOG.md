# Changelog

All notable changes to GitWhisper will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.9.0] - 2026-09-08

### Added
- **Reusable Core SDK (`@gitwhisper/core`)**:
  - Headless, programmatic client via `createGitWhisper({ repository })` without terminal/TTY dependencies.
  - Strict architectural separation of analysis (`analyzeStagedChanges`, `generateCommit`, `generateVariants`, `createCommitPlan`, `checkCommit`, `getCommitTimeline`) from mutation (`commit`, `executeCommitPlan`).
  - Cancellation support via `AbortSignal` across all asynchronous methods.
  - Typed lifecycle event emission (`analysis:*`, `provider:*`, `commit:*`, `error`) without leaking raw diffs or secrets.
  - Structured error taxonomy via `GitWhisperError` (`NOT_A_GIT_REPOSITORY`, `EMPTY_STAGING_AREA`, `OPERATION_ABORTED`, `PRIVACY_VIOLATION`, `POLICY_VIOLATION`, `INVALID_PLAN`, `COMMIT_FAILED`).
- **Editor & MyIDE Integration (`@gitwhisper/editor`)**:
  - Headless integration adapter `MyIDEAdapter` for custom IDEs, VS Code extensions, JetBrains plugins, and language servers.
  - Analytical actions: `generateCommitMessage`, `generateVariants`, `explainCommit` (structured `CommitEvidenceView`), `checkMessage`, `detectMultipleConcerns`, `createCommitPlan`, and `previewCommitPatch`.
  - **Developer Approval Invariant**: `executeApprovedCommit(messageOrPlan, { confirmed: true })` strictly enforces developer confirmation and blocks unconfirmed calls with `CONFIRMATION_REQUIRED`.
  - VS Code command bridge and quick-pick variant formatters (`formatVariantsForQuickPick`, `createVSCodeCommandBridge`).
- **Commit Timeline & History Intelligence**:
  - Structured timeline extraction and deterministic workstream clustering via `getCommitTimeline()` and `clusterCommitsIntoWorkstreams()`.
  - Clusters commits by Conventional scopes, work-item ticket IDs (e.g. `DEV-142`, `#100`), overlapping file changes, and revert commit linking.
  - Merge commit filtering and strictly read-only historical analytics.
  - CLI command: `gitwhisper timeline` with human-readable dashboard, `--details`, `--limit`, and `--json` support.

---

## [0.8.0] - 2026-09-07

### Added
- **Commit Quality Checker (`gitwhisper check`)**:
  - Evaluates commit messages against Conventional Commit syntax, subject length limits (72 chars), trailing punctuation, and specificity.
  - Cross-checks messages against real staged Git evidence (e.g. flagging `feat` claims when only documentation files are staged).
  - Historical commit review on commit-ish targets (`gitwhisper check HEAD`, `gitwhisper check HEAD~1`).
  - Optional advisory AI review via `--ai` flag.
- **Offline Fast Git Hook Integration (`gitwhisper hooks`)**:
  - Standalone <50ms `commit-msg` hook with zero network/AI provider requirements.
  - Operational modes: `warn` (default, diagnostic advice) and `strict` (blocking policy violations).
  - Non-destructive chaining preserving existing user hooks with clean uninstallation.
  - Automatic secret leakage abort in both `warn` and `strict` modes.
- **Team & Repository Commit Policy (`.gitwhisper.json`)**:
  - Centralized repository policy defining custom types, required/strict scopes, work-item reference requirements, and subject lengths.
  - Strict configuration precedence: CLI overrides > User config > Repository config > Learned style > Built-in defaults.
  - Privacy safeguards: repository configurations cannot weaken secret scanning or disable privacy boundaries.

---

## [0.7.0] - 2026-09-06

### Added
- **Branch Intelligence & Intent Context**:
  - Automatic extraction of issue references (`DEV-142`, `#123`, `GH-321`) and feature summaries from Git branch names.
  - Explicit `--issue` / `--work-item` CLI override flags.
- **Work-Item Tracker Integrations**:
  - Pluggable `WorkItemProvider` architecture supporting Generic offline fallback, GitHub Issues REST API, and Jira Cloud/Server REST API.
  - In-memory work-item caching and automatic issue reference insertion into commit subjects or trailer footers (`Refs: DEV-142`, `Fixes: DEV-142`).
- **Security & Network Boundaries**:
  - Credential host-binding invariant preventing token leakage across foreign domains.
  - Cross-origin HTTP redirect stripping of `Authorization` headers and SSRF protocol defense.

---

## [0.6.0] - 2026-09-05

### Added
- **Secret Detection & Redaction**:
  - Multilayer regex and Shannon entropy scanners identifying API keys, cloud credentials, private keys, and tokens in staged diffs.
  - Safe deterministic redaction replacing secrets with placeholders before remote AI transmission.
- **Fail-Closed Privacy Boundaries**:
  - Automatic endpoint classification distinguishing local models (`http://localhost:11434`) from remote endpoints.
  - Fail-closed blocking policy preventing unredacted sensitive payload transmissions.

---

## [0.5.0] - 2026-09-04

### Added
- **Interactive Commit Composer**:
  - Full-screen keyboard-first review dashboard with single-keystroke actions: `[Enter]` Commit, `[1-3]` Variants, `[t]` Type, `[s]` Scope, `[b]` Breaking, `[e]` Edit, `[d]` Details, `[p]` Patch/Plan, `[c]` Copy.
- **Multi-Variant Suggestions**:
  - Generation of three distinct commit message styles: Concise, Descriptive, and Detailed.
- **Terminal Safety**:
  - ANSI and OSC escape sequence sanitization neutralizing terminal injection vulnerabilities.

---

## [0.4.0] - 2026-09-03

### Added
- **Hunk-Level Diff Intelligence & Commit Splitting**:
  - Structured unified diff parsing into individual hunks (`f1:h1`, `f1:h2`).
  - Within-file independent concern detection and semantic grouping.
  - Isolated multi-commit execution using temporary `GIT_INDEX_FILE` plumbing without touching working-tree files or unstaged changes.

---

## [0.3.0] - 2026-09-02

### Added
- **File-Level Concern Clustering & Atomic Splitting**:
  - Structural relationship discovery (source-test pairs, manifest-lockfile pairs, renames, directory prefixes).
  - Graph-based concern clustering into atomic commit groups with cohesion scoring.
  - Commands: `gitwhisper plan` and `gitwhisper split`.

---

## [0.2.0] - 2026-09-01

### Added
- **Conventional Commit Intelligence**:
  - Deterministic candidate ranking for types (`feat`, `fix`, `docs`, `test`, `ci`, `build`, `chore`) and monorepo scope inference.
- **Repository History Style Learning**:
  - Delimiter-based parsing of local Git history extracting commit conventions, subject casing, length distributions, and common scopes.
  - Offline inspection command: `gitwhisper style`.

---

## [0.1.0] - 2026-08-31

### Added
- **Initial Core Release**:
  - Staged Git diff inspection (`git diff --cached`) isolating staged changes from unstaged modifications and untracked files.
  - Direct Git process execution without shell interpolation.
  - BYOK and local LLM provider adapters (Ollama, OpenAI-compatible).
  - Byte-limited diff guarding, binary stripping, and prompt-injection security envelopes.
