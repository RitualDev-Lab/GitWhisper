import { describe, expect, it } from "vitest";
import { checkCommitQuality } from "@gitwhisper/core";
import type { ChangeContext, CommitPolicy } from "@gitwhisper/core";

const policy: CommitPolicy = {
  style: "conventional",
  allowedTypes: ["feat", "fix", "docs", "test", "chore", "refactor"],
  scopes: ["auth", "docs", "cli"],
  requiredScopes: [],
  strictScopes: false,
  maxSubjectLength: 72,
  requireScope: false,
  requireWorkItem: false,
  workItemMode: "reference",
  allowVagueDescriptions: false,
};

function createMockChangeContext(options: {
  hasDocumentation?: boolean;
  hasTests?: boolean;
  hasSource?: boolean;
}): ChangeContext {
  const files: any[] = [];
  if (options.hasDocumentation) {
    files.push({ path: "README.md", category: "documentation", binary: false, status: "modified" });
  }
  if (options.hasTests) {
    files.push({ path: "tests/auth.test.ts", category: "test", binary: false, status: "modified" });
  }
  if (options.hasSource) {
    files.push({ path: "src/auth.ts", category: "source", binary: false, status: "modified" });
  }

  return {
    repository: {
      root: "/mock/repo",
      name: "mock-repo",
      branch: "main",
      head: "abc1234",
      isInitial: false,
    },
    files,
    stats: { filesChanged: files.length, additions: 10, deletions: 2 },
    diffMetadata: { originalBytes: 500, includedBytes: 500, truncated: false },
    characteristics: {
      hasTests: Boolean(options.hasTests),
      hasDocumentation: Boolean(options.hasDocumentation),
      hasConfiguration: false,
      hasDependencies: false,
      hasBinaryChanges: false,
    },
    intelligence: {
      recommendedTypes: [],
      recommendedScopes: [],
      confidence: "high",
    },
  };
}

describe("Commit Quality vs Staged Evidence Checking", () => {
  it("flags commit claiming feat/fix when only documentation changes are staged", async () => {
    const changeContext = createMockChangeContext({ hasDocumentation: true });

    const result = await checkCommitQuality({
      message: "feat(auth): implement new authentication flow",
      policy,
      changeContext,
    });

    const mismatch = result.issues.find((i) => i.code === "EVIDENCE_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe("warning");
    expect(mismatch?.message).toContain("documentation");
    expect(mismatch?.suggestion).toContain("docs");
  });

  it("flags commit claiming feat/fix when only test changes are staged", async () => {
    const changeContext = createMockChangeContext({ hasTests: true });

    const result = await checkCommitQuality({
      message: "feat(auth): fix token expiration issue",
      policy,
      changeContext,
    });

    const mismatch = result.issues.find((i) => i.code === "EVIDENCE_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe("warning");
    expect(mismatch?.message).toContain("test");
    expect(mismatch?.suggestion).toContain("test");
  });

  it("passes without evidence mismatch when docs commit matches staged doc changes", async () => {
    const changeContext = createMockChangeContext({ hasDocumentation: true });

    const result = await checkCommitQuality({
      message: "docs(auth): update authentication architecture guide",
      policy,
      changeContext,
    });

    const mismatch = result.issues.find((i) => i.code === "EVIDENCE_MISMATCH");
    expect(mismatch).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("passes without evidence mismatch when test commit matches staged test changes", async () => {
    const changeContext = createMockChangeContext({ hasTests: true });

    const result = await checkCommitQuality({
      message: "test(auth): add unit tests for token expiration",
      policy,
      changeContext,
    });

    const mismatch = result.issues.find((i) => i.code === "EVIDENCE_MISMATCH");
    expect(mismatch).toBeUndefined();
    expect(result.valid).toBe(true);
  });
});
