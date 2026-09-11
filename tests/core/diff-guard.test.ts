import { DiffTooLargeError, guardDiff } from "@gitwhisper/core";
import type { ClassifiedFileChange } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Diff Guard & Size Limits", () => {
  const dummyFile: ClassifiedFileChange = {
    path: "src/index.ts",
    status: "modified",
    binary: false,
    category: "source",
  };

  it("passes small and moderate diffs without modification", () => {
    const rawDiff = "diff --git a/src/index.ts b/src/index.ts\n+console.log('hi');\n";
    const { sanitizedPatch, metadata } = guardDiff(rawDiff, [dummyFile], { maxSafeBytes: 1000 });

    expect(sanitizedPatch).toBe(rawDiff);
    expect(metadata.truncated).toBe(false);
    expect(metadata.warning).toBeUndefined();
  });

  it("converts binary changes into metadata headers only", () => {
    const binaryFile: ClassifiedFileChange = {
      path: "assets/logo.png",
      status: "added",
      binary: true,
      category: "binary",
    };

    const { sanitizedPatch } = guardDiff("", [binaryFile]);
    expect(sanitizedPatch).toContain("Binary file added: assets/logo.png");
  });

  it("deterministically truncates oversized diffs with warning metadata", () => {
    // Generate a ~2000 byte diff
    const lines = Array.from({ length: 100 }, (_, i) => `+line content number ${i}`).join("\n");
    const { sanitizedPatch, metadata } = guardDiff(lines, [dummyFile], {
      maxSafeBytes: 500,
      hardLimitBytes: 5000,
    });

    expect(metadata.truncated).toBe(true);
    expect(metadata.warning).toBeDefined();
    expect(sanitizedPatch).toContain("[... Diff truncated:");
  });

  it("throws DiffTooLargeError on diffs exceeding hard ceiling", () => {
    const hugeDiff = "x".repeat(10000);
    expect(() => guardDiff(hugeDiff, [dummyFile], { hardLimitBytes: 5000 })).toThrow(
      DiffTooLargeError,
    );
  });
});
