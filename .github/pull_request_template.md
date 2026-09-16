## ?? Summary of Changes

<!-- Briefly describe the problem solved or the feature implemented -->

---

## ?? Monorepo Packages Affected

- [ ] `apps/cli` (Interactive CLI terminal interface)
- [ ] `apps/vscode` (VS Code SCM extension & commands)
- [ ] `packages/core` (Domain models, hunk splitting, style generators)
- [ ] `packages/git` (Direct Git plumbing & diff inspection)
- [ ] `packages/ai` (Model providers: Ollama, OpenAI, Anthropic, Gemini, Groq)
- [ ] `packages/privacy` (AST secret scanner & token redaction rules)
- [ ] Documentation / CI workflows

---

## ?? Type of Change

- [ ] ?? **Bug Fix** (non-breaking fix)
- [ ] ? **New Feature** (new variant style, CLI flag, AI provider)
- [ ] ??? **Privacy / Redaction Improvement** (new secret detector, sanitization rule)
- [ ] ? **Performance Optimization**
- [ ] ?? **Tests Added / Updated**
- [ ] ?? **Documentation Update**

---

## ?? Verification Checklist

Before submitting, please ensure you have checked the following:

- [ ] **Tests Passing**: `pnpm test` runs cleanly and all tests pass.
- [ ] **Type Checked**: `pnpm typecheck` reports 0 TypeScript errors.
- [ ] **Code Quality**: `pnpm lint` and `pnpm format:check` pass without warnings.
- [ ] **Privacy Preservation**: Verified that no unstaged files or unredacted secrets are leaked to LLM payloads.
- [ ] **Direct Git Safety**: Strictly uses `runGit` array arguments without shell string interpolation.
- [ ] **Fail Closed**: Errors gracefully bubble up with actionable messages instead of hallucinated fallbacks.

---

## ?? Demo / Terminal Output (if applicable)

<!-- Paste CLI screenshot or terminal snippet -->
