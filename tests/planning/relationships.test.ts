import { describe, expect, it } from "vitest";
import { discoverRelationships } from "@gitwhisper/core";
import type { ClassifiedFileChange } from "@gitwhisper/core";

describe("Deterministic Relationship Discovery", () => {
  it("detects source <-> test relationships across standard conventions", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: "src/auth/session.ts",
        status: "modified",
        category: "source",
        binary: false,
      },
      {
        path: "tests/auth/session.test.ts",
        status: "added",
        category: "test",
        binary: false,
      },
      {
        path: "src/ui/button.tsx",
        status: "modified",
        category: "source",
        binary: false,
      },
      {
        path: "src/ui/button.spec.tsx",
        status: "modified",
        category: "test",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);

    const sessionRel = rels.find(
      (r) =>
        (r.source === "src/auth/session.ts" && r.target === "tests/auth/session.test.ts") ||
        (r.target === "src/auth/session.ts" && r.source === "tests/auth/session.test.ts"),
    );
    expect(sessionRel).toBeDefined();
    expect(sessionRel?.type).toBe("source-test");
    expect(sessionRel?.confidence).toBeGreaterThanOrEqual(0.85);

    const buttonRel = rels.find(
      (r) =>
        (r.source === "src/ui/button.tsx" && r.target === "src/ui/button.spec.tsx") ||
        (r.target === "src/ui/button.tsx" && r.source === "src/ui/button.spec.tsx"),
    );
    expect(buttonRel).toBeDefined();
    expect(buttonRel?.type).toBe("source-test");
  });

  it("detects manifest <-> lockfile relationships", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: "package.json",
        status: "modified",
        category: "dependency",
        binary: false,
      },
      {
        path: "pnpm-lock.yaml",
        status: "modified",
        category: "dependency",
        binary: false,
      },
      {
        path: "src/index.ts",
        status: "modified",
        category: "source",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);
    const depRel = rels.find((r) => r.type === "manifest-lockfile");
    expect(depRel).toBeDefined();
    expect(depRel?.confidence).toBe(0.99);
    expect([depRel?.source, depRel?.target]).toContain("package.json");
    expect([depRel?.source, depRel?.target]).toContain("pnpm-lock.yaml");
  });

  it("detects renamed files", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: "src/services/auth-new.ts",
        previousPath: "src/services/auth-old.ts",
        status: "renamed",
        category: "source",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);
    const renameRel = rels.find((r) => r.type === "rename");
    expect(renameRel).toBeDefined();
    expect(renameRel?.source).toBe("src/services/auth-old.ts");
    expect(renameRel?.target).toBe("src/services/auth-new.ts");
    expect(renameRel?.confidence).toBe(0.98);
  });

  it("detects common module directory prefix", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: "src/auth/session.ts",
        status: "modified",
        category: "source",
        binary: false,
      },
      {
        path: "src/auth/token.ts",
        status: "modified",
        category: "source",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);
    const dirRel = rels.find((r) => r.type === "directory-prefix");
    expect(dirRel).toBeDefined();
    expect(dirRel?.confidence).toBeGreaterThanOrEqual(0.65);
  });

  it("detects documentation to source coupling", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: "src/auth/session.ts",
        status: "modified",
        category: "source",
        binary: false,
      },
      {
        path: "docs/auth.md",
        status: "modified",
        category: "documentation",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);
    const docRel = rels.find((r) => r.type === "doc-source");
    expect(docRel).toBeDefined();
    expect(docRel?.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
