import { type ClassifiedFileChange, detectTypeCandidates } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Deterministic Type Detector", () => {
  it("strongly prefers 'docs' for documentation-only changes", () => {
    const files: ClassifiedFileChange[] = [
      { path: "README.md", status: "modified", category: "documentation", binary: false },
      { path: "docs/architecture.md", status: "added", category: "documentation", binary: false },
    ];

    const { candidates, signals } = detectTypeCandidates(files, "+new docs\n");
    expect(candidates[0].type).toBe("docs");
    expect(candidates[0].score).toBeGreaterThanOrEqual(0.9);
    expect(candidates[0].confidence).toBe("HIGH");
    expect(signals.some((s) => s.kind === "docs-only")).toBe(true);
  });

  it("strongly prefers 'test' for test-only changes", () => {
    const files: ClassifiedFileChange[] = [
      { path: "src/auth/session.test.ts", status: "modified", category: "test", binary: false },
      { path: "tests/api.spec.ts", status: "added", category: "test", binary: false },
    ];

    const { candidates, signals } = detectTypeCandidates(files, "+expect(true).toBe(true);\n");
    expect(candidates[0].type).toBe("test");
    expect(candidates[0].score).toBeGreaterThanOrEqual(0.9);
    expect(candidates[0].confidence).toBe("HIGH");
    expect(signals.some((s) => s.kind === "test-only")).toBe(true);
  });

  it("strongly prefers 'ci' for CI pipeline changes", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: ".github/workflows/ci.yml",
        status: "modified",
        category: "configuration",
        binary: false,
      },
    ];

    const { candidates, signals } = detectTypeCandidates(files, "+run: pnpm test\n");
    expect(candidates[0].type).toBe("ci");
    expect(candidates[0].confidence).toBe("HIGH");
    expect(signals.some((s) => s.kind === "ci-only")).toBe(true);
  });

  it("identifies build tooling changes", () => {
    const files: ClassifiedFileChange[] = [
      { path: "vite.config.ts", status: "modified", category: "configuration", binary: false },
      { path: "tsconfig.base.json", status: "modified", category: "configuration", binary: false },
    ];

    const { candidates } = detectTypeCandidates(files, "+target: 'es2022'\n");
    expect(candidates[0].type).toBe("build");
    expect(candidates[0].confidence).toBe("HIGH");
  });

  it("identifies dependency-only updates", () => {
    const files: ClassifiedFileChange[] = [
      { path: "package.json", status: "modified", category: "dependency", binary: false },
      { path: "pnpm-lock.yaml", status: "modified", category: "dependency", binary: false },
    ];

    const { candidates } = detectTypeCandidates(files, '+"vitest": "^3.0.0"\n');
    expect(candidates[0].type).toBe("chore");
    expect(candidates[0].score).toBeGreaterThanOrEqual(0.85);
  });

  it("ranks feat/fix for source code changes with supporting tests", () => {
    const files: ClassifiedFileChange[] = [
      { path: "src/auth/session.ts", status: "modified", category: "source", binary: false },
      { path: "tests/session.test.ts", status: "added", category: "test", binary: false },
    ];

    const { candidates, signals } = detectTypeCandidates(files, "+export function validate() {}\n");
    const types = candidates.map((c) => c.type);
    expect(types).toContain("feat");
    expect(types).toContain("fix");
    expect(signals.some((s) => s.kind === "tested-source")).toBe(true);
  });

  it("boosts 'fix' when patch contains bug fix indicators", () => {
    const files: ClassifiedFileChange[] = [
      { path: "src/api.ts", status: "modified", category: "source", binary: false },
    ];

    const patch =
      "+if (!token) throw new Error('handle null exception');\n// fix bug in session check\n";
    const { candidates, signals } = detectTypeCandidates(files, patch);
    const fixCandidate = candidates.find((c) => c.type === "fix");
    expect(fixCandidate).toBeDefined();
    expect(fixCandidate?.score).toBeGreaterThanOrEqual(0.75);
    expect(signals.some((s) => s.kind === "fix-evidence")).toBe(true);
  });
});
