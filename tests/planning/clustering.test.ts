import { describe, expect, it } from "vitest";
import {
  clusterChanges,
  discoverRelationships,
  moveFileBetweenGroups,
  mergeGroups,
  validateCommitPlanInvariants,
  type CommitPlan,
} from "@gitwhisper/core";
import type { ClassifiedFileChange } from "@gitwhisper/core";

describe("Concern Clustering & Commit Planning Graph", () => {
  it("groups coupled source and test into a single concern group", () => {
    const files: ClassifiedFileChange[] = [
      {
        path: "src/auth/session.ts",
        status: "modified",
        category: "source",
        binary: false,
      },
      {
        path: "tests/auth/session.test.ts",
        status: "modified",
        category: "test",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);
    const { groups, cohesionScore } = clusterChanges(files, rels);

    expect(groups).toHaveLength(1);
    expect(groups[0].files).toContain("src/auth/session.ts");
    expect(groups[0].files).toContain("tests/auth/session.test.ts");
    expect(cohesionScore).toBe(1.0);
  });

  it("splits independent concerns (auth + ui + docs) into distinct groups", () => {
    const files: ClassifiedFileChange[] = [
      // Auth concern
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
      // UI concern
      {
        path: "src/ui/nav.tsx",
        status: "modified",
        category: "source",
        binary: false,
      },
      {
        path: "src/ui/theme.css",
        status: "modified",
        category: "source",
        binary: false,
      },
      // Docs concern
      {
        path: "docs/readme.md",
        status: "modified",
        category: "documentation",
        binary: false,
      },
    ];

    const rels = discoverRelationships(files);
    const { groups, cohesionScore } = clusterChanges(files, rels);

    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(cohesionScore).toBeLessThan(1.0);

    // Verify auth files are grouped together
    const authGroup = groups.find((g) => g.files.includes("src/auth/session.ts"));
    expect(authGroup?.files).toContain("src/auth/token.ts");
    expect(authGroup?.files).not.toContain("src/ui/nav.tsx");

    // Verify UI files are grouped together
    const uiGroup = groups.find((g) => g.files.includes("src/ui/nav.tsx"));
    expect(uiGroup?.files).toContain("src/ui/theme.css");
    expect(uiGroup?.files).not.toContain("src/auth/session.ts");
  });

  it("enforces release-blocking invariants strictly", () => {
    const validPlan: CommitPlan = {
      id: "plan-1",
      timestamp: new Date().toISOString(),
      indexFingerprint: "abcd1234abcd1234abcd1234abcd1234abcd1234",
      totalFiles: 2,
      isSingleConcern: true,
      cohesionScore: 1.0,
      groups: [
        {
          id: "g1",
          name: "Auth",
          concern: "Authentication",
          files: ["src/a.ts", "src/b.ts"],
          relationships: [],
          confidence: 0.9,
        },
      ],
      relationships: [],
      warnings: [],
    };

    // Valid passes without throwing
    expect(() => validateCommitPlanInvariants(validPlan, ["src/a.ts", "src/b.ts"])).not.toThrow();

    // Duplicate file across groups throws
    const duplicatePlan: CommitPlan = {
      ...validPlan,
      groups: [
        { ...validPlan.groups[0], files: ["src/a.ts"] },
        {
          id: "g2",
          name: "Other",
          concern: "Other",
          files: ["src/a.ts"],
          relationships: [],
          confidence: 0.9,
        },
      ],
    };
    expect(() => validateCommitPlanInvariants(duplicatePlan, ["src/a.ts"])).toThrow(
      /assigned to multiple groups/,
    );

    // Staged file missing from plan throws
    expect(() =>
      validateCommitPlanInvariants(validPlan, ["src/a.ts", "src/b.ts", "src/c.ts"]),
    ).toThrow(/missing from commit plan groups/);
  });

  it("supports moving files between groups and merging groups", () => {
    const initialPlan: CommitPlan = {
      id: "plan-test",
      timestamp: new Date().toISOString(),
      indexFingerprint: "1111222233334444111122223333444411112222",
      totalFiles: 3,
      isSingleConcern: false,
      cohesionScore: 0.5,
      groups: [
        {
          id: "g1",
          name: "Group 1",
          concern: "Concern 1",
          files: ["src/a.ts", "src/b.ts"],
          relationships: [],
          confidence: 0.9,
        },
        {
          id: "g2",
          name: "Group 2",
          concern: "Concern 2",
          files: ["src/c.ts"],
          relationships: [],
          confidence: 0.9,
        },
      ],
      relationships: [],
      warnings: [],
    };

    // Move src/b.ts to g2
    const moved = moveFileBetweenGroups(initialPlan, "src/b.ts", "g2");
    expect(moved.groups.find((g) => g.id === "g1")?.files).toEqual(["src/a.ts"]);
    expect(moved.groups.find((g) => g.id === "g2")?.files).toEqual(["src/c.ts", "src/b.ts"]);

    // Merge g1 into g2
    const merged = mergeGroups(moved, "g1", "g2");
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0].files).toEqual(["src/c.ts", "src/b.ts", "src/a.ts"]);
    expect(merged.isSingleConcern).toBe(true);
  });
});
