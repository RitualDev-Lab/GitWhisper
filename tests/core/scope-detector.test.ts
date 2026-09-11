import {
  type ClassifiedFileChange,
  detectScopeCandidates,
  extractScopeFromPath,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Scope Detector & Boundary Inference", () => {
  it("extracts feature scope from directory path without using generic 'src'", () => {
    expect(extractScopeFromPath("src/auth/session.ts")).toBe("auth");
    expect(extractScopeFromPath("src/editor/layout.ts")).toBe("editor");
    expect(extractScopeFromPath("lib/database/client.ts")).toBe("database");
  });

  it("extracts monorepo package and app names accurately", () => {
    expect(extractScopeFromPath("packages/git/src/executor.ts")).toBe("git");
    expect(extractScopeFromPath("apps/cli/src/index.ts")).toBe("cli");
    expect(extractScopeFromPath("apps/web/src/components/Button.tsx")).toBe("web");
  });

  it("never returns generic directories as scopes", () => {
    const scope = extractScopeFromPath("src/index.ts");
    expect(scope).toBeNull();
  });

  it("ranks single-directory changes with high confidence", () => {
    const files: ClassifiedFileChange[] = [
      { path: "src/auth/session.ts", status: "modified", category: "source", binary: false },
      { path: "src/auth/token.ts", status: "modified", category: "source", binary: false },
      { path: "tests/auth/auth.test.ts", status: "added", category: "test", binary: false },
    ];

    const candidates = detectScopeCandidates(files);
    expect(candidates[0].scope).toBe("auth");
    expect(candidates[0].confidence).toBe("HIGH");
  });

  it("suggests 'deps' scope for dependency changes", () => {
    const files: ClassifiedFileChange[] = [
      { path: "package.json", status: "modified", category: "dependency", binary: false },
      { path: "pnpm-lock.yaml", status: "modified", category: "dependency", binary: false },
    ];

    const candidates = detectScopeCandidates(files);
    expect(candidates[0].scope).toBe("deps");
  });

  it("respects configured scopes and strict scope filtering", () => {
    const files: ClassifiedFileChange[] = [
      { path: "src/billing/invoice.ts", status: "modified", category: "source", binary: false },
    ];

    // With configured scopes
    const candidates = detectScopeCandidates(files, {
      configuredScopes: ["billing", "auth", "api"],
    });
    expect(candidates[0].scope).toBe("billing");
    expect(candidates[0].score).toBeGreaterThanOrEqual(0.9);

    // With strict scopes where 'billing' is not present
    const strictCandidates = detectScopeCandidates(files, {
      configuredScopes: ["auth", "api"],
      strictScopes: true,
    });
    expect(strictCandidates.map((c) => c.scope)).not.toContain("billing");
  });
});
