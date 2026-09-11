import { type SecretFinding, scanCommitMessage } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 7 Commit Message & Secret Echo Scanner", () => {
  it("allows clean commit messages with no secrets or placeholders", async () => {
    const result = await scanCommitMessage(
      "feat(auth): implement token refresh strategy",
      "Refactors the authentication service to use rotating sessions cleanly.",
    );
    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.placeholdersFound).toHaveLength(0);
  });

  it("detects raw secrets in commit message subject or body", async () => {
    const result = await scanCommitMessage(
      "fix(auth): update api key to sk-syntheticSecretKey1234567890123456789",
    );
    expect(result.safe).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("detects echo of staged secrets in commit message", async () => {
    const stagedSecret = "synthetic_staged_super_secret_token_1234";
    const mockFinding: SecretFinding = {
      id: "f-1",
      category: "api-key",
      detector: "known-format",
      confidence: "high",
      filePath: "src/secret.ts",
      lineNumber: 5,
      lineType: "added",
      matchedText: stagedSecret,
      maskedPreview: "synt****1234",
      startColumn: 0,
      endColumn: 39,
      placeholder: "<GITWHISPER_REDACTED_SECRET>",
      fingerprint: "abc12345",
    };

    const result = await scanCommitMessage(
      "chore: configure environment with token",
      `The token is ${stagedSecret}`,
      { stagedFindings: [mockFinding] },
    );

    expect(result.safe).toBe(false);
    expect(result.findings.some((f) => f.matchedText === stagedSecret)).toBe(true);
  });

  it("detects and rejects unresolved redaction placeholders in commit messages", async () => {
    const result = await scanCommitMessage(
      "fix(api): set authorization header to <GITWHISPER_REDACTED_AUTH_TOKEN>",
      "Uses <GITWHISPER_REDACTED_API_KEY> for service calls.",
    );

    expect(result.safe).toBe(false);
    expect(result.placeholdersFound).toContain("<GITWHISPER_REDACTED_AUTH_TOKEN>");
    expect(result.placeholdersFound).toContain("<GITWHISPER_REDACTED_API_KEY>");
  });
});
