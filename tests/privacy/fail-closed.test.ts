import { PrivacyScanError, type SecretDetector, scanSensitiveContent } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 7 Fail-Closed Error Boundary", () => {
  it("fails closed when any detector throws an unexpected runtime error", async () => {
    const faultyDetector: SecretDetector = {
      name: "faulty-crash-detector",
      scan: () => {
        throw new Error("Simulated unexpected crash or OOM during scanning");
      },
    };

    await expect(
      scanSensitiveContent(
        { patch: "diff --git a/test.ts b/test.ts\n+const x = 1;" },
        { detectors: [faultyDetector] },
      ),
    ).rejects.toThrow(PrivacyScanError);

    try {
      await scanSensitiveContent(
        { patch: "diff --git a/test.ts b/test.ts\n+const x = 1;" },
        { detectors: [faultyDetector] },
      );
    } catch (err: any) {
      expect(err).toBeInstanceOf(PrivacyScanError);
      expect(err.isFailClosed).toBe(true);
      expect(err.message).toContain("unexpected error during execution");
    }
  });

  it("fails closed when diff size exceeds maxScanSizeBytes limit", async () => {
    // Config with a tiny 100 byte limit for testing
    const oversizedPatch = "a".repeat(150);

    await expect(
      scanSensitiveContent({ patch: oversizedPatch }, { config: { maxScanSizeBytes: 100 } }),
    ).rejects.toThrow(PrivacyScanError);

    try {
      await scanSensitiveContent({ patch: oversizedPatch }, { config: { maxScanSizeBytes: 100 } });
    } catch (err: any) {
      expect(err.isFailClosed).toBe(true);
      expect(err.message).toContain("exceeds maximum scan limit");
    }
  });
});
