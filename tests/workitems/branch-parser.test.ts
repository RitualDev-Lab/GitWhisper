import { parseBranchContext } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 8 Branch Intelligence & Reference Extraction", () => {
  it("extracts Jira/Linear issue references from branch names", () => {
    const ctx = parseBranchContext("feature/DEV-142-session-timeout");
    expect(ctx.detached).toBe(false);
    expect(ctx.references.length).toBe(1);
    expect(ctx.references[0].key).toBe("DEV-142");
    expect(ctx.references[0].providerHint).toBe("jira");
    expect(ctx.references[0].confidence).toBe("high");
    expect(ctx.normalizedDescription).toBe("session timeout");
  });

  it("extracts GitHub issue references from branch names", () => {
    const ctx = parseBranchContext("bugfix/GH-321-invalid-token");
    expect(ctx.references.length).toBe(1);
    expect(ctx.references[0].key).toBe("#321");
    expect(ctx.references[0].providerHint).toBe("github");
    expect(ctx.normalizedDescription).toBe("invalid token");
  });

  it("extracts category-prefixed issue numbers", () => {
    const ctx = parseBranchContext("fix/123-auth-timeout");
    expect(ctx.references.length).toBe(1);
    expect(ctx.references[0].key).toBe("#123");
    expect(ctx.references[0].providerHint).toBe("github");
    expect(ctx.normalizedDescription).toBe("auth timeout");
  });

  it("handles multiple issue references on a single branch", () => {
    const ctx = parseBranchContext("feature/DEV-142-GH-331-auth");
    expect(ctx.references.length).toBe(2);
    const keys = ctx.references.map((r) => r.key);
    expect(keys).toContain("DEV-142");
    expect(keys).toContain("#331");
  });

  it("gracefully handles detached HEAD without throwing", () => {
    const ctx = parseBranchContext("(detached at 7eac423)");
    expect(ctx.detached).toBe(true);
    expect(ctx.references).toEqual([]);
    expect(ctx.confidence).toBe("low");
  });

  it("gracefully handles null or empty branch name", () => {
    const ctx = parseBranchContext(null);
    expect(ctx.detached).toBe(true);
    expect(ctx.references).toEqual([]);
  });

  it("rejects false positives such as semver versions, dates, and UUIDs", () => {
    const semverCtx = parseBranchContext("release/v1.2.0");
    expect(semverCtx.references).toEqual([]);

    const dateCtx = parseBranchContext("hotfix/2026-09-08");
    expect(dateCtx.references).toEqual([]);

    const uuidCtx = parseBranchContext("user/123e4567-e89b-12d3-a456-426614174000");
    expect(uuidCtx.references).toEqual([]);
  });

  it("neutralizes terminal ANSI escapes in branch names", () => {
    const maliciousBranch = "feature/\x1b[31mDEV-99\x1b[0m-drop-table";
    const ctx = parseBranchContext(maliciousBranch);
    expect(ctx.references.length).toBe(1);
    expect(ctx.references[0].key).toBe("DEV-99");
    expect(ctx.name).not.toContain("\x1b[31m");
  });
});
