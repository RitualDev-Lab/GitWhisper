# GitWhisper Capabilities & Roadmap

This document provides a truthful record of current GitWhisper capabilities. Features are strictly classified as **IMPLEMENTED**, **PARTIAL**, or **PLANNED**. We never claim planned features are implemented.

---

## Current Status (Phase 8)

| Capability | Status | Description |
| :--- | :---: | :--- |
| **Real Staged Git Diff** | `IMPLEMENTED` | Discovers and reads only the staged Git index (`git diff --cached`). Completely ignores unstaged modifications and untracked files. |
| **Direct Git Process Execution** | `IMPLEMENTED` | Executes `git` directly using argument arrays with zero shell interpolation. Full support for paths with spaces, Unicode filenames, renames, and deletions. |
| **Repository Detection** | `IMPLEMENTED` | Authoritatively resolves Git root, active branch, detached HEAD, and zero-commit initial repositories. |
| **Basic Change Classification** | `IMPLEMENTED` | Deterministic categorization of files into test, documentation, dependency, configuration, source, and binary types. |
| **Diff Guard & Truncation** | `IMPLEMENTED` | Enforces byte limits, strips raw binary content, deterministically truncates oversized diffs with warnings, and rejects dangerously large diffs. |
| **Ollama Local Provider** | `IMPLEMENTED` | Native HTTP adapter for local Ollama instances (`http://localhost:11434`), supporting local JSON output mode and model verification. |
| **OpenAI-Compatible BYOK Provider**| `IMPLEMENTED` | BYOK adapter compatible with any OpenAI-compatible API (cloud or local gateways like LM Studio, LocalAI, vLLM). |
| **Privacy Visibility** | `IMPLEMENTED` | Explicit badges display whether changes stay strictly `Local` or are sent to a `Remote` endpoint. |
| **Conventional Commit Structure** | `IMPLEMENTED` | First-class Conventional Commit model (`type(scope): description`) with support for standard and custom commit types. |
| **Deterministic Type Candidates** | `IMPLEMENTED` | Rule-based type detection with scored evidence reasons (docs-only, test-only, ci-only, build-only, deps-only, source+tests). Facts constrain LLM candidates. |
| **Scope Candidate Inference** | `IMPLEMENTED` | Infers components from directory structures and monorepo boundaries while filtering out generic paths (`src`, `lib`, `packages`, `apps`). |
| **Deterministic Commit Validator**| `IMPLEMENTED` | Validates allowed types, scopes, single-line constraints, maximum subject length (72 chars), and rejects vague descriptions (`update files`, `make changes`). |
| **User Interactive Overrides** | `IMPLEMENTED` | Keyboard workflow enabling instant developer overrides: `[t]` Type, `[s]` Scope, `[b]` Breaking change, `[e]` Edit message, `[r]` Regenerate wording, `[d]` Details view. |
| **Prompt Injection Defense** | `IMPLEMENTED` | Untrusted staged diffs are bounded in explicit security envelopes and treated strictly as inert data. System instructions forbid following embedded instructions. |
| **Evidence & Details View** | `IMPLEMENTED` | `[d]` Details action shows why GitWhisper suggested specific types/scopes, signal weights, alternative candidates, and staged breakdowns. |
| **Commit Execution & Hash Verification** | `IMPLEMENTED` | Invokes real `git commit` upon explicit user approval, capturing and displaying the authoritative Git short hash. |
| **Dry Run Mode** | `IMPLEMENTED` | `--dry-run` flag allows inspecting detected type/scope and evaluating generated commit messages without invoking `git commit`. |
| **Sanitized Debug Logging** | `IMPLEMENTED` | `--debug` flag logs execution metrics, candidate scores, and timings while strictly redacting API keys, authorization headers, and raw source diffs. |
| **Local Git History Analysis** | `IMPLEMENTED` | Safe delimiter-based reading of local Git history (`git log`) without human output parsing or remote network requirements. |
| **Repository Style Profiling** | `IMPLEMENTED` | Deterministic extraction of commit conventions, subject casing, length distributions, trailing periods, body frequency, emoji, and ticket prefixes. |
| **Conventional Style Detection** | `IMPLEMENTED` | Measures repository conventional commit ratio; detects Conventional, Simple / Imperative, Mixed, or Unknown styles with deterministic confidence thresholds. |
| **Historical Scope Learning** | `IMPLEMENTED` | Correlates historical directory path prefixes to scope identifiers with observation scoring and consistency confidence. |
| **Automatic Style Mode** | `IMPLEMENTED` | `style: "auto"` dynamically adapts to strong repository conventions (e.g. Simple sentence subjects vs Conventional Commits) with graceful fallbacks. |
| **Decision Provenance** | `IMPLEMENTED` | Structured tracking of decisions (Type, Scope, Style, Casing, Length, Body) with explicit attribution across User, Config, Git, History, or Default. |
| **Offline Style Inspector** | `IMPLEMENTED` | `gitwhisper style` CLI command inspecting repository conventions with human-readable, `--details`, and `--json` formats without AI required. |
| **Deterministic Relationship Graph** | `IMPLEMENTED` | Discovers structural couplings prior to AI: source-test pairs, manifest-lockfile pairs, renames, directory prefixes, direct imports, and docs-source. |
| **Change Concern Clustering** | `IMPLEMENTED` | Clusters graph connected components into atomic commit candidate groups with cohesion scoring and semantic naming. |
| **Safe File-Level Commit Splitting** | `IMPLEMENTED` | Transaction-like multi-commit execution using isolated `GIT_INDEX_FILE` plumbing. Unstaged edits and untracked files are never mutated, lost, or committed. |
| **Index Fingerprinting & Invariants** | `IMPLEMENTED` | Computes authoritative 40-char SHA-1 tree hash (`git write-tree`) to guard against stale plan execution; enforces release-blocking file invariants. |
| **Real Hook Execution & Interruption**| `IMPLEMENTED` | Runs real pre-commit and commit-msg hooks on each group; halts immediately on failure with clear status reporting and index sync. |
| **Plan & Split CLI Commands** | `IMPLEMENTED` | `gitwhisper plan` (`--level=file|hunk|auto`, `--json`, `--details`), `gitwhisper split` (`--dry-run`), and interactive split suggestion in `gitwhisper`. |
| **Hunk-Level Commit Splitting** | `IMPLEMENTED` | Deconstructs staged patches into structured hunks (`f1:h1`, `f1:h2`), detects within-file independent concerns, and executes safe partial commits via `GIT_INDEX_FILE` and `git apply --cached --recount` plumbing without touching disk files or unstaged changes. |
| **Interactive Commit Composer** | `IMPLEMENTED` | Full keyboard-first review dashboard with immediate `[Enter]` commit path, live active variant tabs, and error taxonomy. |
| **Multi-Variant Suggestions** | `IMPLEMENTED` | Parallel generation of 3 distinct variants (`[1]` Concise, `[2]` Descriptive, `[3]` Detailed) with diversity measurement and deduplication. |
| **Terminal Escape & OSC Sanitization**| `IMPLEMENTED` | Sanitizes all branch names, commit messages, and file paths to neutralize ANSI injection, OSC window title hacks, and clipboard hijacks. |
| **External Editor Integration** | `IMPLEMENTED` | Interactive in-terminal editing and optional `$EDITOR` / `$VISUAL` launch for custom formatting with comment striping. |
| **Cross-Platform Clipboard Copy** | `IMPLEMENTED` | `[c]` key copies active commit message to system clipboard across macOS (`pbcopy`), Windows (`clip`), and Linux (`wl-copy`/`xclip`). |
| **Non-TTY Piped Execution** | `IMPLEMENTED` | `gitwhisper generate | pbcopy` and `--quiet` stream clean, unformatted commit messages suitable for shell scripts and pipelines. |
| **Secret Detection & Redaction** | `IMPLEMENTED` | Multilayer regex and Shannon entropy scanners identify sensitive tokens (API keys, cloud credentials, tokens, private keys) in staged diffs and issue summaries, replacing them with deterministic placeholders. |
| **Fail-Closed Privacy Boundaries** | `IMPLEMENTED` | Automatically detects remote endpoint targets and blocks unredacted sensitive payload transmissions. Staged index strictly isolated from working tree and untracked files. |
| **Branch Intelligence & Intent Context** | `IMPLEMENTED` | Parses active Git branch to extract issue references (`DEV-142`, `#123`, `GH-321`) and normalized feature descriptions with detached HEAD tolerance and ANSI neutralization. |
| **Work-Item & Tracker Integrations** | `IMPLEMENTED` | Pluggable WorkItemProvider architecture supporting zero-network Generic fallback, GitHub Issues REST adapter, and Jira Cloud/Server REST adapter. |
| **Credential Host-Binding Invariant** | `IMPLEMENTED` | Release-blocking security invariant binding developer credentials strictly to configured hosts. Rejects repository configuration spoofing. |
| **Redirect & SSRF Protocol Protection** | `IMPLEMENTED` | Automatically strips Authorization headers on cross-origin redirects; rejects non-HTTP/HTTPS protocols. |
| **Commit Quality Checker** | `IMPLEMENTED` | `gitwhisper check [target]` evaluates commit message quality against staged evidence, policy, subject length, specificity, breaking changes, and secret leakage. |
| **Historical Commit Review** | `IMPLEMENTED` | Inspects historical commits (`gitwhisper check HEAD`, `HEAD~1`) extracting structured metadata, patches, and quality ratings. |
| **Offline Git Hook Integration** | `IMPLEMENTED` | Safe, deterministic, <50ms `commit-msg` hook with zero network/AI dependency, non-destructive chaining, and automatic secret blocking in both `warn` and `strict` modes. |
| **Team Commit Policy Model** | `IMPLEMENTED` | Centralized repository configuration (`.gitwhisper.json`) defining custom types, required/strict scopes, work-item requirements, and max subject lengths with strict precedence. |
| **Reusable Core SDK** | `IMPLEMENTED` | Headless, programmatic TypeScript API via `@gitwhisper/core` (`createGitWhisper`) with strict separation of analysis vs mutation, AbortSignal cancellation, and typed event emissions. |
| **Editor & MyIDE Integration** | `IMPLEMENTED` | Headless IDE integration layer via `@gitwhisper/editor` (`MyIDEAdapter`, VSCode bridge) with mandatory developer confirmation invariant, evidence views, and privacy enforcement. |
| **Commit Timeline & History Intelligence** | `IMPLEMENTED` | Deterministic workstream clustering, revert pairing, work-item grouping, and CLI timeline dashboard (`gitwhisper timeline`) with strictly read-only historical analytics. |
| **PR & Release Notes Generation** | `PLANNED` | Generating multi-commit pull request descriptions and release changelogs. |

