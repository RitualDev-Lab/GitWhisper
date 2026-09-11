# GitWhisper Core SDK & Editor Integration Reference

`@gitwhisper/core` and `@gitwhisper/editor` provide headless programmatic APIs for embedding GitWhisper commit intelligence, quality checks, secret redaction, and timeline analytics into IDEs, Language Servers, CI/CD runners, and developer tools.

---

## 1. Reusable Core SDK (`@gitwhisper/core`)

### Installation & Import

```ts
import { createGitWhisper } from "@gitwhisper/core";

const gw = await createGitWhisper({
  repository: process.cwd(),
});
```

### Core Architecture & Invariants

* **Separation of Analysis and Mutation**:
  All analytical functions (`analyzeStagedChanges`, `generateCommit`, `generateVariants`, `createCommitPlan`, `checkCommit`, `analyzeRepositoryStyle`, `getCommitTimeline`) are strictly read-only and will never alter the repository or staged index.
* **Mutation Requires Explicit Intent**:
  Repository state is only mutated when `gw.commit()` or `gw.executeCommitPlan()` is explicitly called.
* **Cancellation via AbortSignal**:
  All asynchronous methods accept an optional `signal: AbortSignal`. If aborted, operations cleanly reject with a `GitWhisperError` (`code: "OPERATION_ABORTED"`).
* **Typed Event Emission**:
  Subscribe to lifecycle events via `gw.on(event, listener)`:
  - `analysis:start`, `analysis:complete`
  - `provider:start`, `provider:complete`
  - `commit:start`, `commit:complete`
  - `error`
  Event payloads never leak raw source diffs, confidential code, or unredacted secrets.

### API Methods

```ts
// 1. Repository Status
const status = await gw.getRepositoryStatus();
// => { root, name, branch, head, isInitial, hasStagedChanges, stagedFilesCount }

// 2. Structured Staged Change Analysis
const context = await gw.analyzeStagedChanges();
// => ChangeContext (files, stats, patch, characteristics, intelligence)

// 3. Commit Generation
const result = await gw.generateCommit({
  variant: "descriptive", // "concise" | "descriptive" | "detailed"
  style: "conventional",   // "auto" | "conventional" | "simple"
});
// => CommitGenerationResult (proposal, variants, classification, evidence, privacy)

// 4. Multi-Variant Generation
const variants = await gw.generateVariants();
// => SDKMultiVariantResult (concise, descriptive, detailed variants)

// 5. Commit Planning & Hunk-Level Splitting
const plan = await gw.createCommitPlan({ level: "auto" });
// => HunkCommitPlan | CommitPlan

// 6. Quality & Policy Verification
const quality = await gw.checkCommit("feat(auth): add login endpoint", {
  strict: true,
});
// => CommitQualityResult (valid, score, rating, issues, checks)

// 7. Timeline & Workstream Intelligence
const timeline = await gw.getCommitTimeline({ limit: 50 });
// => CommitTimeline (commits, workstreams, summary)

// 8. Commit Mutation
const committed = await gw.commit(result.proposal);
// => { hash: "123fe0e", message: "..." }
```

---

## 2. Editor & IDE Integration (`@gitwhisper/editor`)

`@gitwhisper/editor` provides the `MyIDEAdapter` designed for custom IDEs, VS Code extensions, JetBrains plugins, and language servers.

### Usage

```ts
import { MyIDEAdapter } from "@gitwhisper/editor";

const adapter = new MyIDEAdapter({
  repositoryRoot: "/path/to/project",
  editorName: "MyIDE",
  activeFilePath: "src/auth.ts",
});

// Explain commit decisions (provenance, signals, privacy status)
const explanation = await adapter.explainCommit();
if (explanation.success) {
  console.log(explanation.data.reasons);
}

// Check for multi-concern changes
const concerns = await adapter.detectMultipleConcerns();
if (concerns.data?.multipleConcernsDetected) {
  const plan = await adapter.createCommitPlan();
}

// Execute commit with required developer confirmation
const commitResult = await adapter.executeApprovedCommit(
  "feat(auth): implement token refresh",
  { confirmed: true }, // REQUIRED: Invariant prevents silent commits
);
```

### Safety Invariant: Explicit Approval Required

Calling `executeApprovedCommit` with `{ confirmed: false }` or omitting the confirmation parameter will immediately return an error (`CONFIRMATION_REQUIRED`) without touching Git.

---

## 3. Commit Timeline & History Intelligence

Available via SDK (`gw.getCommitTimeline()`) or CLI (`gitwhisper timeline`):

```bash
# Human-readable workstream dashboard
gitwhisper timeline

# Detailed workstream breakdown with files and revert links
gitwhisper timeline --details --limit 50

# Machine-readable JSON output
gitwhisper timeline --json
```

### Deterministic Clustering Signals
- **Conventional Scopes**: Commits sharing scopes are clustered into cohesive feature streams.
- **Work-Item References**: Commits referencing ticket IDs (e.g. `DEV-142`, `#100`) are grouped with high confidence.
- **Shared File Overlap**: Commits modifying overlapping core modules are grouped together.
- **Revert Pairing**: Revert commits are automatically matched with their target commit and grouped in the same workstream.
- **Merge Filtering**: Merge commits are filtered out by default to focus on actual feature iterations.
- **Read-Only**: Timeline intelligence is strictly analytical; it never rebases, squashes, or rewrites history.
