import { type ChangeContext, analyzeRepositoryHistory, resolveCommitStyle } from "@gitwhisper/core";
import type { GitCommitRecord } from "@gitwhisper/git";
import { describe, expect, it } from "vitest";

function makeContext(
  files: string[],
  topType: string,
  typeConfidence: "HIGH" | "MEDIUM" | "LOW",
): ChangeContext {
  return {
    repository: { root: "/repo", name: "repo", branch: "main", head: "123", isInitial: false },
    files: files.map((p) => ({
      path: p,
      status: "modified",
      binary: false,
      category: p.endsWith(".md") ? "documentation" : "source",
    })),
    stats: { additions: 10, deletions: 2, filesChanged: files.length },
    patch: "diff content",
    diffMetadata: { totalBytes: 100, truncated: false },
    characteristics: {
      hasTests: false,
      hasDocumentation: files.some((f) => f.endsWith(".md")),
      hasConfiguration: false,
      hasDependencies: false,
      hasBinaryChanges: false,
    },
    intelligence: {
      fileCategories: {
        total: files.length,
        documentation: files.filter((f) => f.endsWith(".md")).length,
        source: files.filter((f) => !f.endsWith(".md")).length,
        test: 0,
        dependency: 0,
        configuration: 0,
        binary: 0,
        unknown: 0,
      },
      affectedDirectories: [],
      packageChanges: [],
      configChanges: [],
      testChanges: [],
      documentationChanges: files.filter((f) => f.endsWith(".md")),
      sourceChanges: files.filter((f) => !f.endsWith(".md")),
      ciChanges: [],
      buildChanges: [],
      probableScopes: [
        { scope: "docs", score: 0.9, reasons: ["Documentation file"], confidence: "HIGH" },
      ],
      probableTypes: [
        {
          type: topType,
          score: 0.95,
          reasons: [`Files are ${topType}`],
          confidence: typeConfidence,
        },
      ],
      signals: [],
    },
  };
}

describe("Commit Style Precedence & Provenance", () => {
  const baseConfig = {
    style: "auto" as const,
    maxSubjectLength: 60,
    requireScope: false,
    body: "auto" as const,
    allowedTypes: ["feat", "fix", "docs", "chore", "refactor"],
  };

  it("User explicit override beats everything (history, staged facts, config)", () => {
    // 50 historical conventional commits
    const history = analyzeRepositoryHistory(
      Array.from({ length: 50 }, () => ({
        hash: "1".repeat(40),
        parents: ["p"],
        subject: "feat(auth): login",
      })),
    );

    const context = makeContext(["README.md"], "docs", "HIGH");

    const resolved = resolveCommitStyle({
      config: baseConfig,
      context,
      historyProfile: history,
      userOverrides: {
        forcedType: "chore",
        forcedScope: "release",
      },
    });

    expect(resolved.allowedTypes).toContain("chore");
    const typeProv = resolved.provenance.find((p) => p.field === "type");
    expect(typeProv?.decision).toBe("chore");
    expect(typeProv?.source).toBe("user");

    const scopeProv = resolved.provenance.find((p) => p.field === "scope");
    expect(scopeProv?.decision).toBe("release");
    expect(scopeProv?.source).toBe("user");
  });

  it("Config limit strictly caps subject length even if historical median is larger", () => {
    // History with very long subjects (median 80)
    const history = analyzeRepositoryHistory(
      Array.from({ length: 20 }, () => ({
        hash: "1".repeat(40),
        parents: ["p"],
        subject: `feat(auth): ${"a".repeat(75)}`,
      })),
      { minimumSampleSize: 5 },
    );

    const context = makeContext(["src/index.ts"], "feat", "MEDIUM");

    const resolved = resolveCommitStyle({
      config: { ...baseConfig, maxSubjectLength: 50 },
      context,
      historyProfile: history,
    });

    // 50 is configured max, history is ~80
    expect(resolved.targetLength).toBeLessThanOrEqual(50);
  });

  it("Current staged facts strictly beat history popularity (e.g. docs-only staged diff never becomes feat)", () => {
    // History has 100% feat
    const history = analyzeRepositoryHistory(
      Array.from({ length: 50 }, () => ({
        hash: "1".repeat(40),
        parents: ["p"],
        subject: "feat(core): add shiny feature",
      })),
    );

    // Current staged change is docs-only
    const context = makeContext(["README.md"], "docs", "HIGH");

    const resolved = resolveCommitStyle({
      config: baseConfig,
      context,
      historyProfile: history,
    });

    const typeProv = resolved.provenance.find((p) => p.field === "type");
    expect(typeProv?.decision).toBe("docs");
    expect(typeProv?.source).toBe("git");
    // Allowed types for model strictly restricted to docs/chore
    expect(resolved.allowedTypes).toEqual(["docs", "chore"]);
  });

  it("Auto style mode selects simple style when history strongly uses simple commits", () => {
    const history = analyzeRepositoryHistory(
      Array.from({ length: 30 }, (_, i) => ({
        hash: "1".repeat(40),
        parents: ["p"],
        subject: `Add OAuth callback handling ${i}`,
      })),
      { minimumSampleSize: 5 },
    );

    const context = makeContext(["src/auth.ts"], "feat", "LOW");

    const resolved = resolveCommitStyle({
      config: { ...baseConfig, style: "auto" },
      context,
      historyProfile: history,
    });

    expect(resolved.effectiveStyle).toBe("simple");
    const styleProv = resolved.provenance.find((p) => p.field === "style");
    expect(styleProv?.source).toBe("history");
    expect(styleProv?.decision).toBe("simple");
  });

  it("Explicit config style overrides history learning (e.g. style: conventional overrides simple history)", () => {
    const history = analyzeRepositoryHistory(
      Array.from({ length: 30 }, (_, i) => ({
        hash: "1".repeat(40),
        parents: ["p"],
        subject: `Add OAuth callback handling ${i}`,
      })),
      { minimumSampleSize: 5 },
    );

    const context = makeContext(["src/auth.ts"], "feat", "LOW");

    const resolved = resolveCommitStyle({
      config: { ...baseConfig, style: "conventional" },
      context,
      historyProfile: history,
    });

    expect(resolved.effectiveStyle).toBe("conventional");
    const styleProv = resolved.provenance.find((p) => p.field === "style");
    expect(styleProv?.source).toBe("config");
  });
});
