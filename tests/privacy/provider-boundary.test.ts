import {
  type ChangeContext,
  PrivacyPolicyBlockedError,
  prepareProviderContext,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 7 Provider Privacy Boundary & Data Minimization", () => {
  const createMockContext = (patchContent: string): ChangeContext => ({
    repository: {
      root: "/mock/repo",
      name: "super-secret-project-name",
      branch: "feature/confidential-internal-branch",
      head: "abc1234",
      isInitial: false,
    },
    files: [
      {
        path: "src/keys.ts",
        status: "added",
        binary: false,
        category: "source",
      },
    ],
    stats: { additions: 1, deletions: 0, filesChanged: 1 },
    patch: `
diff --git a/src/keys.ts b/src/keys.ts
@@ -0,0 +1 @@
+${patchContent}
`,
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
  });

  it("blocks remote transmission when high-confidence secrets are staged and policy is 'block'", async () => {
    const context = createMockContext('const awsKey = "AKIAIOSFODNN7EXAMPLE";');

    await expect(
      prepareProviderContext({
        changeContext: context,
        baseUrl: "https://api.openai.com/v1",
        privacyConfig: {
          scanSecrets: true,
          remote: { highConfidence: "block", mediumConfidence: "redact", lowConfidence: "warn" },
        },
      }),
    ).rejects.toThrow(PrivacyPolicyBlockedError);
  });

  it("safely redacts secrets when allowRedactionOnBlock is requested", async () => {
    const context = createMockContext('const awsKey = "AKIAIOSFODNN7EXAMPLE";');

    const safeContext = await prepareProviderContext({
      changeContext: context,
      baseUrl: "https://api.openai.com/v1",
      allowRedactionOnBlock: true,
      privacyConfig: {
        scanSecrets: true,
        remote: { highConfidence: "block", mediumConfidence: "redact", lowConfidence: "warn" },
      },
    });

    expect(safeContext.isSanitized).toBe(true);
    expect(safeContext.changeContext.patch).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(safeContext.changeContext.patch).toContain("<GITWHISPER_REDACTED_AWS_KEY>");
    expect(safeContext.redactions.length).toBeGreaterThan(0);
    expect(safeContext.decision.state).toBe("blocked");
  });

  it("enforces remote data minimization (stripping branch and repo names)", async () => {
    const context = createMockContext('export const hello = "world";');

    const safeContext = await prepareProviderContext({
      changeContext: context,
      baseUrl: "https://api.openai.com/v1",
      privacyConfig: {
        scanSecrets: true,
        sendBranchName: false,
        sendRepositoryName: false,
      },
    });

    expect(safeContext.providerLocation).toBe("remote");
    expect(safeContext.changeContext.repository.branch).toBeNull();
    expect(safeContext.changeContext.repository.name).toBe("");
    expect(safeContext.transmissionReport.branchStripped).toBe(true);
    expect(safeContext.transmissionReport.repoNameStripped).toBe(true);
  });

  it("preserves branch and repo name for local loopback providers when configured", async () => {
    const context = createMockContext('export const hello = "world";');

    const safeContext = await prepareProviderContext({
      changeContext: context,
      baseUrl: "http://localhost:11434",
      privacyConfig: {
        scanSecrets: true,
        sendBranchName: true,
        sendRepositoryName: true,
      },
    });

    expect(safeContext.providerLocation).toBe("local");
    expect(safeContext.changeContext.repository.branch).toBe(
      "feature/confidential-internal-branch",
    );
    expect(safeContext.changeContext.repository.name).toBe("super-secret-project-name");
    expect(safeContext.transmissionReport.branchStripped).toBe(false);
  });
});
