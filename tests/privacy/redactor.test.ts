import {
  type ChangeContext,
  type SecretFinding,
  redactChangeContext,
  redactPatch,
  redactText,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

const SYNTHETIC_STRIPE_KEY = ["sk", "live", "syntheticApiKey1234567890"].join("_");
const SYNTHETIC_GHP_KEY = ["ghp", "syntheticOldToken1111222233334444"].join("_");

describe("Phase 7 Redaction Engine", () => {
  const mockFinding: SecretFinding = {
    id: "f-1",
    category: "api-key",
    detector: "known-format",
    confidence: "high",
    filePath: "src/api.ts",
    lineNumber: 10,
    lineType: "added",
    matchedText: SYNTHETIC_STRIPE_KEY,
    maskedPreview: "sk_l****7890",
    startColumn: 15,
    endColumn: 49,
    placeholder: "<GITWHISPER_REDACTED_STRIPE_KEY>",
    fingerprint: "abc12345",
  };

  it("redacts matched secrets from diff while preserving unified diff structure", () => {
    const rawPatch = `diff --git a/src/api.ts b/src/api.ts
index 1234567..89abcdef 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -8,3 +8,3 @@
 const url = "https://api.stripe.com";
-const key = "old_dummy";
+const key = "${SYNTHETIC_STRIPE_KEY}";
 export default url;
`;

    const { sanitizedPatch, redactions } = redactPatch(rawPatch, [mockFinding]);

    expect(sanitizedPatch).not.toContain(SYNTHETIC_STRIPE_KEY);
    expect(sanitizedPatch).toContain("<GITWHISPER_REDACTED_STRIPE_KEY>");
    expect(sanitizedPatch).toContain("diff --git a/src/api.ts b/src/api.ts");
    expect(sanitizedPatch).toContain("@@ -8,3 +8,3 @@");
    expect(sanitizedPatch).toContain('+const key = "<GITWHISPER_REDACTED_STRIPE_KEY>";');

    expect(redactions).toHaveLength(1);
    expect(redactions[0]?.placeholder).toBe("<GITWHISPER_REDACTED_STRIPE_KEY>");
    expect(redactions[0]?.filePath).toBe("src/api.ts");
  });

  it("redacts secrets in both added and deleted lines", () => {
    const deletedFinding: SecretFinding = {
      ...mockFinding,
      id: "f-2",
      lineType: "deleted",
      matchedText: SYNTHETIC_GHP_KEY,
      placeholder: "<GITWHISPER_REDACTED_GITHUB_TOKEN>",
    };

    const patch = `
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,2 @@
-const oldToken = "${SYNTHETIC_GHP_KEY}";
+const newToken = "${SYNTHETIC_STRIPE_KEY}";
`;

    const { sanitizedPatch } = redactPatch(patch, [mockFinding, deletedFinding]);

    expect(sanitizedPatch).not.toContain(SYNTHETIC_GHP_KEY);
    expect(sanitizedPatch).not.toContain(SYNTHETIC_STRIPE_KEY);
    expect(sanitizedPatch).toContain('-const oldToken = "<GITWHISPER_REDACTED_GITHUB_TOKEN>";');
    expect(sanitizedPatch).toContain('+const newToken = "<GITWHISPER_REDACTED_STRIPE_KEY>";');
  });

  it("sanitizes text blocks via redactText", () => {
    const text = `Found secret: ${SYNTHETIC_STRIPE_KEY} in the code.`;
    const result = redactText(text, [mockFinding]);
    expect(result).toBe("Found secret: <GITWHISPER_REDACTED_STRIPE_KEY> in the code.");
  });

  it("redacts entire ChangeContext patch", () => {
    const context: ChangeContext = {
      repository: {
        root: "/repo",
        name: "test-repo",
        branch: "main",
        head: "abc",
        isInitial: false,
      },
      files: [],
      stats: { additions: 1, deletions: 0, filesChanged: 1 },
      patch: `const key = "${SYNTHETIC_STRIPE_KEY}";`,
      diffMetadata: { originalBytes: 100, includedBytes: 100, truncated: false },
      characteristics: {
        hasTests: false,
        hasDocumentation: false,
        hasConfiguration: false,
        hasDependencies: false,
        hasBinaryChanges: false,
      },
      intelligence: {
        probableTypes: [],
        probableScopes: [],
        typeEvidence: [],
        scopeEvidence: [],
      },
    };

    const { sanitizedContext, redactions } = redactChangeContext(context, [mockFinding]);
    expect(sanitizedContext.patch).not.toContain(SYNTHETIC_STRIPE_KEY);
    expect(sanitizedContext.patch).toContain("<GITWHISPER_REDACTED_STRIPE_KEY>");
    expect(redactions).toHaveLength(1);
  });
});
