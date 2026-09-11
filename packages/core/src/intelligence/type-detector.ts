import type { ClassifiedFileChange } from "../types.js";
import type { ChangeSignal, ConfidenceLevel, FileCategorySummary, TypeCandidate } from "./types.js";

const CI_PATTERNS = [
  /(^|[/\\])\.github[/\\]workflows[/\\]/i,
  /(^|[/\\])\.gitlab-ci\.yml$/i,
  /(^|[/\\])\.circleci[/\\]/i,
  /(^|[/\\])azure-pipelines\.ya?ml$/i,
  /(^|[/\\])Jenkinsfile/i,
];

const BUILD_PATTERNS = [
  /^(vite|webpack|rollup|tsup|rspack|esbuild)\.config\./i,
  /^tsconfig.*\.json$/i,
  /^biome\.json$/i,
  /^\.?(babel|swc|postcss|tailwind)/i,
];

export function isCiFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return CI_PATTERNS.some((p) => p.test(normalized));
}

export function isBuildFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() || "";
  return BUILD_PATTERNS.some((p) => p.test(filename));
}

export function summarizeCategories(files: ClassifiedFileChange[]): FileCategorySummary {
  const summary: FileCategorySummary = {
    total: files.length,
    test: 0,
    documentation: 0,
    dependency: 0,
    configuration: 0,
    source: 0,
    binary: 0,
    unknown: 0,
  };

  for (const f of files) {
    summary[f.category] = (summary[f.category] || 0) + 1;
  }

  return summary;
}

function scoreToConfidence(score: number): ConfidenceLevel {
  if (score >= 0.85) return "HIGH";
  if (score >= 0.5) return "MEDIUM";
  return "LOW";
}

/**
 * Deterministically analyzes staged file changes and diff signals to rank commit type candidates.
 */
export function detectTypeCandidates(
  files: ClassifiedFileChange[],
  rawPatch: string,
): { candidates: TypeCandidate[]; signals: ChangeSignal[] } {
  if (files.length === 0) {
    return {
      candidates: [
        { type: "chore", score: 0.1, reasons: ["No staged changes detected"], confidence: "LOW" },
      ],
      signals: [],
    };
  }

  const summary = summarizeCategories(files);
  const signals: ChangeSignal[] = [];
  const candidatesMap = new Map<string, { score: number; reasons: string[] }>();

  const addCandidate = (type: string, score: number, reason: string) => {
    const existing = candidatesMap.get(type);
    if (!existing) {
      candidatesMap.set(type, { score, reasons: [reason] });
    } else {
      existing.score = Math.min(1.0, existing.score + score * 0.4);
      if (!existing.reasons.includes(reason)) {
        existing.reasons.push(reason);
      }
    }
  };

  const allCi = files.every((f) => isCiFile(f.path));
  const allBuild = files.every((f) => isBuildFile(f.path));
  const allDocs = summary.documentation === summary.total;
  const allTests = summary.test === summary.total;
  const allDeps = summary.dependency === summary.total;

  // 1. CI-only check
  if (allCi) {
    signals.push({
      kind: "ci-only",
      source: "path",
      evidence: "All staged files match continuous integration pipeline configurations.",
      weight: 1.0,
    });
    addCandidate("ci", 0.95, "Only CI configuration files were changed");
    addCandidate("chore", 0.2, "Maintenance of CI infrastructure");
  }
  // 2. Documentation-only check
  else if (allDocs) {
    signals.push({
      kind: "docs-only",
      source: "path",
      evidence: "All staged files are documentation (README, markdown, or guides).",
      weight: 1.0,
    });
    addCandidate("docs", 0.96, "Only documentation files were modified or added");
    addCandidate("chore", 0.15, "Non-code documentation maintenance");
  }
  // 3. Test-only check
  else if (allTests) {
    signals.push({
      kind: "test-only",
      source: "path",
      evidence: "All staged files are test suites or test specifications.",
      weight: 1.0,
    });
    addCandidate("test", 0.95, "Only test files were changed");
    addCandidate("chore", 0.15, "Test suite maintenance");
  }
  // 4. Build-tooling check
  else if (allBuild) {
    signals.push({
      kind: "build-only",
      source: "path",
      evidence: "All staged files are build tooling configurations (vite, tsconfig, bundlers).",
      weight: 0.9,
    });
    addCandidate("build", 0.92, "Build system or bundler configurations modified");
    addCandidate("chore", 0.3, "Build tool maintenance");
  }
  // 5. Dependency-only check
  else if (allDeps) {
    signals.push({
      kind: "deps-only",
      source: "metadata",
      evidence: "Only dependency manifests and lockfiles were changed.",
      weight: 0.9,
    });
    addCandidate("chore", 0.88, "Dependency manifest and lockfile updates");
    addCandidate("build", 0.5, "External build dependencies updated");
  }
  // 6. Mixed or Source changes
  else {
    const hasSource = summary.source > 0;
    const hasTests = summary.test > 0;
    const hasDocs = summary.documentation > 0;

    if (hasTests && hasSource) {
      signals.push({
        kind: "tested-source",
        source: "metadata",
        evidence: `${summary.source} source file(s) changed alongside ${summary.test} test file(s).`,
        weight: 0.8,
      });
    }

    if (hasDocs && hasSource) {
      signals.push({
        kind: "documented-source",
        source: "metadata",
        evidence: "Source code updated with corresponding documentation.",
        weight: 0.7,
      });
    }

    // Inspect patch content for semantic hints
    const lowerPatch = rawPatch.toLowerCase();
    const addedFiles = files.filter((f) => f.status === "added" && f.category === "source");

    if (addedFiles.length > 0) {
      signals.push({
        kind: "new-modules",
        source: "git",
        evidence: `New source module(s) created: ${addedFiles.map((f) => f.path).join(", ")}.`,
        weight: 0.8,
      });
      addCandidate("feat", 0.78, "New source modules or exports introduced");
    }

    // Check for bug-fix keywords in diff
    const fixIndicators = [
      "fix(",
      "bug",
      "error",
      "issue",
      "exception",
      "handle null",
      "handle undefined",
      "prevent",
      "crash",
      "race condition",
    ];
    let fixMatches = 0;
    for (const ind of fixIndicators) {
      if (lowerPatch.includes(ind)) fixMatches++;
    }

    if (fixMatches > 0) {
      signals.push({
        kind: "fix-evidence",
        source: "patch",
        evidence: `Found ${fixMatches} fix/error handling indicator(s) in staged patch.`,
        weight: 0.75,
      });
      addCandidate(
        "fix",
        0.72 + Math.min(0.2, fixMatches * 0.05),
        "Fixes or error handling logic found in patch",
      );
    }

    // Check for perf keywords
    const perfIndicators = [
      "perf",
      "benchmark",
      "optimize",
      "memoize",
      "cache",
      "latency",
      "throughput",
    ];
    let perfMatches = 0;
    for (const ind of perfIndicators) {
      if (lowerPatch.includes(ind)) perfMatches++;
    }

    if (perfMatches >= 2) {
      signals.push({
        kind: "perf-evidence",
        source: "patch",
        evidence: "Found performance-related indicators in patch.",
        weight: 0.7,
      });
      addCandidate("perf", 0.7, "Performance optimization indicators present in patch");
    }

    // Add baseline candidates for source changes
    if (hasSource) {
      if (!candidatesMap.has("feat")) {
        addCandidate("feat", 0.65, "Source changes potentially introducing new functionality");
      }
      if (!candidatesMap.has("fix")) {
        addCandidate("fix", 0.6, "Source changes potentially resolving an existing issue");
      }
      addCandidate("refactor", 0.55, "Source changes modifying implementation structure");
    }
  }

  // Convert to sorted array
  const candidates: TypeCandidate[] = Array.from(candidatesMap.entries())
    .map(([type, data]) => ({
      type,
      score: Number(data.score.toFixed(2)),
      reasons: data.reasons,
      confidence: scoreToConfidence(data.score),
    }))
    .sort((a, b) => b.score - a.score);

  return { candidates, signals };
}
