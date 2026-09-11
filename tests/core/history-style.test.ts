import { analyzeRepositoryHistory, detectStringCase } from "@gitwhisper/core";
import type { GitCommitRecord } from "@gitwhisper/git";
import { describe, expect, it } from "vitest";

function makeCommit(subject: string, body?: string, parents: string[] = ["p1"]): GitCommitRecord {
  return {
    hash: "a".repeat(40),
    parents,
    authorDate: "2026-09-07T12:00:00Z",
    subject,
    body,
  };
}

describe("Repository Style Profiler & Conventional Detection", () => {
  it("detects casing accurately", () => {
    expect(detectStringCase("add user authentication")).toBe("lowercase");
    expect(detectStringCase("Add user authentication")).toBe("sentence");
    expect(detectStringCase("Add User Authentication System")).toBe("title");
    expect(detectStringCase("ADD AUTH TIMEOUT")).toBe("uppercase");
    expect(detectStringCase("")).toBe("unknown");
  });

  it("detects HIGH confidence Conventional Commits when ratio >= 75%", () => {
    const commits: GitCommitRecord[] = [];
    // 45 conventional commits
    for (let i = 0; i < 45; i++) {
      commits.push(makeCommit(`feat(auth): add login feature ${i}`));
    }
    // 5 non-conventional commits
    for (let i = 0; i < 5; i++) {
      commits.push(makeCommit(`Miscellaneous cleanup ${i}`));
    }

    const profile = analyzeRepositoryHistory(commits);
    expect(profile.sampleSize).toBe(50);
    expect(profile.convention.style).toBe("conventional");
    expect(profile.convention.confidence).toBe("HIGH");
    expect(profile.convention.conventionalRatio).toBe(0.9);
    expect(profile.types[0].type).toBe("feat");
    expect(profile.types[0].count).toBe(45);
    expect(profile.scopes[0].scope).toBe("auth");
    expect(profile.scopes[0].count).toBe(45);
    expect(profile.formatting.subjectCase).toBe("lowercase");
  });

  it("detects MEDIUM confidence for mixed / moderate conventional ratio (60%)", () => {
    const commits: GitCommitRecord[] = [];
    for (let i = 0; i < 30; i++) {
      commits.push(makeCommit(`fix(api): handle timeout ${i}`));
    }
    for (let i = 0; i < 20; i++) {
      commits.push(makeCommit(`Update documentation ${i}`));
    }

    const profile = analyzeRepositoryHistory(commits);
    expect(profile.sampleSize).toBe(50);
    expect(profile.convention.confidence).toBe("MEDIUM");
    expect(profile.convention.conventionalRatio).toBe(0.6);
  });

  it("detects Simple / Imperative style when conventional ratio <= 25%", () => {
    const commits: GitCommitRecord[] = [];
    for (let i = 0; i < 40; i++) {
      commits.push(makeCommit(`Add OAuth callback handling ${i}`));
    }
    for (let i = 0; i < 10; i++) {
      commits.push(makeCommit(`fix: patch bug ${i}`));
    }

    const profile = analyzeRepositoryHistory(commits);
    expect(profile.sampleSize).toBe(50);
    expect(profile.convention.style).toBe("simple");
    expect(profile.convention.confidence).toBe("HIGH");
    expect(profile.convention.conventionalRatio).toBe(0.2);
    expect(profile.formatting.subjectCase).toBe("sentence");
  });

  it("measures subject length metrics (average, median, max)", () => {
    const commits = [
      makeCommit("short"), // 5
      makeCommit("medium length msg"), // 17
      makeCommit("very long commit message for testing"), // 36
    ];

    const profile = analyzeRepositoryHistory(commits, { minimumSampleSize: 1 });
    expect(profile.formatting.medianSubjectLength).toBe(17);
    expect(profile.formatting.maxObservedSubjectLength).toBe(36);
    expect(profile.formatting.averageSubjectLength).toBe(19);
  });

  it("measures trailing period frequency and body usage", () => {
    const commits = [
      makeCommit("feat: add feature 1.", "Some body description\n"),
      makeCommit("feat: add feature 2.", "Another body\n"),
      makeCommit("feat: add feature 3"),
      makeCommit("feat: add feature 4"),
    ];

    const profile = analyzeRepositoryHistory(commits, { minimumSampleSize: 1 });
    expect(profile.formatting.trailingPeriodFrequency).toBe(0.5);
    expect(profile.formatting.bodyUsageFrequency).toBe(0.5);
  });

  it("detects emoji, issue references, and ticket prefixes", () => {
    const commits = [
      makeCommit("✨ feat: add dashboard"),
      makeCommit("🐛 fix: handle timeout"),
      makeCommit("AUTH-123 add session refresh"),
      makeCommit("AUTH-124 fix expired token (#456)"),
      makeCommit("DEV-99 update deps"),
    ];

    const profile = analyzeRepositoryHistory(commits, { minimumSampleSize: 1 });
    expect(profile.features.usesEmoji).toBe(true);
    expect(profile.features.usesIssueReferences).toBe(true);
    expect(profile.features.usesTicketPrefixes).toBe(true);
  });

  it("assigns LOW confidence when history is below minimum sample size (<5)", () => {
    const commits = [makeCommit("feat(auth): add login"), makeCommit("fix(auth): handle timeout")];

    const profile = analyzeRepositoryHistory(commits, { minimumSampleSize: 5 });
    expect(profile.sampleSize).toBe(2);
    expect(profile.convention.confidence).toBe("LOW");
  });

  it("handles empty history gracefully", () => {
    const profile = analyzeRepositoryHistory([]);
    expect(profile.sampleSize).toBe(0);
    expect(profile.convention.style).toBe("unknown");
    expect(profile.convention.confidence).toBe("LOW");
    expect(profile.types).toEqual([]);
    expect(profile.scopes).toEqual([]);
  });

  it("ignores merge commits from style calculations by default", () => {
    const commits = [
      makeCommit("feat: commit 1"),
      makeCommit("feat: commit 2"),
      makeCommit("Merge pull request #123 from feat", undefined, ["p1", "p2"]),
    ];

    const profile = analyzeRepositoryHistory(commits, {
      minimumSampleSize: 1,
      includeMergeCommits: false,
    });
    expect(profile.sampleSize).toBe(2);
    expect(profile.ignoredMerges).toBe(1);
    expect(profile.totalAnalyzed).toBe(3);
  });
});
