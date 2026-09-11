import { buildHistoricalScopeMappings } from "@gitwhisper/core";
import type { GitCommitRecord } from "@gitwhisper/git";
import { describe, expect, it } from "vitest";

function makeCommitWithFiles(subject: string, files: string[]): GitCommitRecord {
  return {
    hash: "b".repeat(40),
    parents: ["p1"],
    subject,
    files,
  };
}

describe("Historical Path-to-Scope Mapping", () => {
  it("infers pathPrefix -> scope mappings with HIGH confidence for repeated correlations", () => {
    const commits = [
      makeCommitWithFiles("feat(auth): add auth token", ["packages/auth/src/token.ts"]),
      makeCommitWithFiles("fix(auth): fix session expiry", ["packages/auth/src/session.ts"]),
      makeCommitWithFiles("test(auth): add auth tests", ["packages/auth/tests/auth.test.ts"]),
      makeCommitWithFiles("feat(api): add endpoints", ["packages/api/src/routes.ts"]),
      makeCommitWithFiles("fix(api): fix cors", ["packages/api/src/server.ts"]),
    ];

    const mappings = buildHistoricalScopeMappings(commits);
    expect(mappings.length).toBeGreaterThanOrEqual(2);

    const authMapping = mappings.find((m) => m.pathPrefix === "packages/auth");
    expect(authMapping).toBeDefined();
    expect(authMapping?.scope).toBe("auth");
    expect(authMapping?.observations).toBe(3);
    expect(authMapping?.confidence).toBe("HIGH");

    const apiMapping = mappings.find((m) => m.pathPrefix === "packages/api");
    expect(apiMapping).toBeDefined();
    expect(apiMapping?.scope).toBe("api");
    expect(apiMapping?.observations).toBe(2);
    expect(apiMapping?.confidence).toBe("MEDIUM");
  });

  it("assigns LOW confidence or lower consistency when scopes conflict on same path", () => {
    const commits = [
      makeCommitWithFiles("feat(auth): add token", ["packages/auth/src/token.ts"]),
      makeCommitWithFiles("fix(security): fix vulnerability", ["packages/auth/src/token.ts"]),
      makeCommitWithFiles("refactor(core): refactor token", ["packages/auth/src/token.ts"]),
    ];

    const mappings = buildHistoricalScopeMappings(commits);
    const authMapping = mappings.find((m) => m.pathPrefix === "packages/auth");
    expect(authMapping).toBeDefined();
    expect(authMapping?.confidence).toBe("LOW");
  });
});
