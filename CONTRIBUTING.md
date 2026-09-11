# Contributing to GitWhisper

Thank you for contributing to GitWhisper! We welcome issues, suggestions, and pull requests.

## Development Setup

Prerequisites:
- Node.js >= 20
- pnpm >= 9
- Git

```bash
# Clone the repository
git clone https://github.com/RitualDev/gitwhisper.git
cd gitwhisper

# Install dependencies
pnpm install

# Build all packages and CLI
pnpm build

# Run automated tests
pnpm test

# Run quality checks
pnpm typecheck
pnpm lint
pnpm format:check
```

## Architecture Principles

1. **Direct Git Execution**: Never use shell string interpolation (`exec("git ...")`). Use direct argument arrays with `runGit` in `@gitwhisper/git`.
2. **Fail Closed**: Never emit fallback commit messages when an AI model or Git command fails. Always surface clean, actionable error messages.
3. **Privacy First**: Never allow unstaged or untracked file contents into generation contexts.
4. **Real Tests**: Write integration tests that exercise real Git operations on temporary repositories.
