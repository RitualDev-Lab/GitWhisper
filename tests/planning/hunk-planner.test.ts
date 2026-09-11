import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildHunkCommitPlan,
  moveHunkBetweenGroups,
  mergeHunkGroups,
  validateHunkPlanInvariants,
  type HunkCommitPlan,
} from "@gitwhisper/core";
import { commitStagedChanges, runGit } from "@gitwhisper/git";

describe("Hunk Commit Planner & Invariants", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitwhisper-hunk-plan-"));
    await runGit(["init"], { cwd: tempDir });
    await runGit(["config", "user.name", "Planner Tester"], { cwd: tempDir });
    await runGit(["config", "user.email", "planner@gitwhisper.local"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "README.md"), "# Init\n");
    await runGit(["add", "README.md"], { cwd: tempDir });
    await commitStagedChanges(tempDir, { subject: "chore: init repo" });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("validates that all staged hunks must be accounted for", () => {
    const mockPlan: HunkCommitPlan = {
      id: "plan-1",
      timestamp: new Date().toISOString(),
      granularity: "hunk",
      indexFingerprint: "abc1234",
      totalFiles: 1,
      totalHunks: 2,
      isSingleConcern: false,
      cohesionScore: 0.5,
      groups: [
        {
          id: "group-1",
          name: "Group 1",
          concern: "Concern 1",
          confidence: 0.8,
          hunkIds: ["f1:h1"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h1"], wholeFile: false }],
        },
      ],
      relationships: [],
      patch: { files: [] },
      warnings: [],
    };

    // Missing f1:h2 must throw
    expect(() => validateHunkPlanInvariants(mockPlan, ["f1:h1", "f1:h2"])).toThrow(
      /missing from commit plan groups/,
    );
  });

  it("validates that duplicate hunk assignments are rejected", () => {
    const mockPlan: HunkCommitPlan = {
      id: "plan-1",
      timestamp: new Date().toISOString(),
      granularity: "hunk",
      indexFingerprint: "abc1234",
      totalFiles: 1,
      totalHunks: 2,
      isSingleConcern: false,
      cohesionScore: 0.5,
      groups: [
        {
          id: "group-1",
          name: "Group 1",
          concern: "Concern 1",
          confidence: 0.8,
          hunkIds: ["f1:h1"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h1"], wholeFile: false }],
        },
        {
          id: "group-2",
          name: "Group 2",
          concern: "Concern 2",
          confidence: 0.8,
          hunkIds: ["f1:h1"], // Duplicate
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h1"], wholeFile: false }],
        },
      ],
      relationships: [],
      patch: { files: [] },
      warnings: [],
    };

    expect(() => validateHunkPlanInvariants(mockPlan, ["f1:h1"])).toThrow(
      /assigned to multiple groups/,
    );
  });

  it("validates that unknown hunk IDs are rejected", () => {
    const mockPlan: HunkCommitPlan = {
      id: "plan-1",
      timestamp: new Date().toISOString(),
      granularity: "hunk",
      indexFingerprint: "abc1234",
      totalFiles: 1,
      totalHunks: 1,
      isSingleConcern: true,
      cohesionScore: 1.0,
      groups: [
        {
          id: "group-1",
          name: "Group 1",
          concern: "Concern 1",
          confidence: 0.8,
          hunkIds: ["f1:h99"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h99"], wholeFile: false }],
        },
      ],
      relationships: [],
      patch: { files: [] },
      warnings: [],
    };

    expect(() => validateHunkPlanInvariants(mockPlan, ["f1:h1"])).toThrow(
      /contains unknown\/unstaged hunk ID/,
    );
  });

  it("allows moving hunks between groups interactively", () => {
    const mockPlan: HunkCommitPlan = {
      id: "plan-1",
      timestamp: new Date().toISOString(),
      granularity: "hunk",
      indexFingerprint: "abc1234",
      totalFiles: 1,
      totalHunks: 2,
      isSingleConcern: false,
      cohesionScore: 0.5,
      groups: [
        {
          id: "g1",
          name: "Group 1",
          concern: "Concern 1",
          confidence: 0.8,
          hunkIds: ["f1:h1"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h1"], wholeFile: false }],
        },
        {
          id: "g2",
          name: "Group 2",
          concern: "Concern 2",
          confidence: 0.8,
          hunkIds: ["f1:h2"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h2"], wholeFile: false }],
        },
      ],
      relationships: [],
      patch: {
        files: [
          {
            oldPath: "src/app.ts",
            newPath: "src/app.ts",
            status: "modified",
            fileIndex: 1,
            hunks: [
              {
                id: "f1:h1",
                fileIndex: 1,
                hunkIndex: 1,
                fingerprint: "h1",
                oldStart: 1,
                oldCount: 1,
                newStart: 1,
                newCount: 3,
                lines: [],
              },
              {
                id: "f1:h2",
                fileIndex: 1,
                hunkIndex: 2,
                fingerprint: "h2",
                oldStart: 50,
                oldCount: 1,
                newStart: 52,
                newCount: 3,
                lines: [],
              },
            ],
          },
        ],
      },
      warnings: [],
    };

    const moved = moveHunkBetweenGroups(mockPlan, "f1:h2", "g1");
    expect(moved.groups).toHaveLength(1);
    expect(moved.groups[0].hunkIds).toEqual(["f1:h1", "f1:h2"]);
    expect(moved.isSingleConcern).toBe(true);
  });

  it("merges two hunk groups together cleanly", () => {
    const mockPlan: HunkCommitPlan = {
      id: "plan-1",
      timestamp: new Date().toISOString(),
      granularity: "hunk",
      indexFingerprint: "abc1234",
      totalFiles: 1,
      totalHunks: 2,
      isSingleConcern: false,
      cohesionScore: 0.5,
      groups: [
        {
          id: "g1",
          name: "Auth Group",
          concern: "Authentication",
          confidence: 0.8,
          hunkIds: ["f1:h1"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h1"], wholeFile: false }],
        },
        {
          id: "g2",
          name: "Analytics Group",
          concern: "Analytics",
          confidence: 0.8,
          hunkIds: ["f1:h2"],
          fileChanges: [{ file: "src/app.ts", hunkIds: ["f1:h2"], wholeFile: false }],
        },
      ],
      relationships: [],
      patch: {
        files: [
          {
            oldPath: "src/app.ts",
            newPath: "src/app.ts",
            status: "modified",
            fileIndex: 1,
            hunks: [
              {
                id: "f1:h1",
                fileIndex: 1,
                hunkIndex: 1,
                fingerprint: "h1",
                oldStart: 1,
                oldCount: 1,
                newStart: 1,
                newCount: 3,
                lines: [],
              },
              {
                id: "f1:h2",
                fileIndex: 1,
                hunkIndex: 2,
                fingerprint: "h2",
                oldStart: 50,
                oldCount: 1,
                newStart: 52,
                newCount: 3,
                lines: [],
              },
            ],
          },
        ],
      },
      warnings: [],
    };

    const merged = mergeHunkGroups(mockPlan, "g2", "g1");
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0].hunkIds).toEqual(["f1:h1", "f1:h2"]);
    expect(merged.groups[0].concern).toContain("Authentication; Analytics");
  });
});
