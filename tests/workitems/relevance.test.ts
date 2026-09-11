import type { ChangeCharacteristics, ChangeContext, ClassifiedFileChange } from "@gitwhisper/core";
import { evaluateIntentRelevance } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

function createMockChangeContext(
  files: Array<{ path: string; category: ClassifiedFileChange["category"] }>,
  characteristicsPartial: Partial<ChangeCharacteristics> = {},
): ChangeContext {
  const classifiedFiles: ClassifiedFileChange[] = files.map((f) => ({
    path: f.path,
    status: "modified",
    binary: false,
    category: f.category,
    additions: 10,
    deletions: 2,
  }));

  const characteristics: ChangeCharacteristics = {
    hasTests: false,
    hasDocumentation: false,
    hasConfiguration: false,
    hasDependencies: false,
    hasBinaryChanges: false,
    ...characteristicsPartial,
  };

  return {
    repository: {
      root: "/mock/repo",
      name: "repo",
      branch: "feature/DEV-142",
      head: "1234567",
      isInitial: false,
    },
    files: classifiedFiles,
    stats: { filesChanged: files.length, additions: 10, deletions: 2 },
    patch: "mock patch",
    diffMetadata: { originalBytes: 100, includedBytes: 100, truncated: false },
    characteristics,
    intelligence: {
      fileCategories: {
        total: files.length,
        test: 0,
        documentation: 0,
        dependency: 0,
        configuration: 0,
        source: files.length,
        binary: 0,
        unknown: 0,
      },
      affectedDirectories: ["src/auth"],
      packageChanges: [],
      configChanges: [],
      testChanges: [],
      documentationChanges: [],
      sourceChanges: files.map((f) => f.path),
      ciChanges: [],
      buildChanges: [],
      probableScopes: [{ scope: "auth", score: 0.9, reasons: [], confidence: "HIGH" }],
      probableTypes: [{ type: "fix", score: 0.9, reasons: [], confidence: "HIGH" }],
      signals: [],
    },
  };
}

describe("Phase 8 Work-Item Relevance Engine", () => {
  it("computes HIGH relevance when staged files overlap with work-item title and scope", () => {
    const context = createMockChangeContext([
      { path: "src/auth/session.ts", category: "source" },
      { path: "tests/session.test.ts", category: "test" },
    ]);

    const workItem = {
      provider: "jira" as const,
      key: "DEV-142",
      title: "Refresh auth sessions before timeout expiry",
      labels: ["security", "auth"],
    };

    const branch = {
      name: "feature/DEV-142-session-timeout",
      detached: false,
      references: [
        { raw: "DEV-142", key: "DEV-142", source: "branch" as const, confidence: "high" as const },
      ],
      normalizedDescription: "session timeout",
      confidence: "high" as const,
    };

    const { relevance, evidence } = evaluateIntentRelevance(workItem, branch, context);
    expect(relevance).toBe("high");
    expect(evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("MANDATORY TEST: detects docs conflict when issue describes OAuth feature but diff is README only", () => {
    // Section 98: Issue "Add OAuth support", staged: README typo only
    // Relevance must be LOW and not claim feature completion
    const context = createMockChangeContext([{ path: "README.md", category: "documentation" }], {
      hasDocumentation: true,
      hasTests: false,
    });

    const workItem = {
      provider: "jira" as const,
      key: "DEV-142",
      title: "Add OAuth login and user authentication system",
    };

    const { relevance, evidence } = evaluateIntentRelevance(workItem, undefined, context);
    expect(relevance).toBe("low");
    expect(evidence.some((e) => e.signal === "docs-conflict")).toBe(true);
  });

  it("returns unknown when no work item is present and branch has no references", () => {
    const context = createMockChangeContext([{ path: "src/utils.ts", category: "source" }]);
    const { relevance } = evaluateIntentRelevance(undefined, undefined, context);
    expect(relevance).toBe("unknown");
  });
});
