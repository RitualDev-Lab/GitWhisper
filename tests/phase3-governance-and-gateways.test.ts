import { describe, expect, it } from "vitest";
import { AwsBedrockProvider } from "../packages/ai/src/providers/aws-bedrock.js";
import { AzureOpenAIProvider } from "../packages/ai/src/providers/azure-openai.js";
import {
  ShannonEntropyDetector,
  calculateShannonEntropy,
} from "../packages/core/src/privacy/detectors/shannon-entropy.js";
import { EnterpriseIssueKeyValidator } from "../packages/core/src/workitems/enterprise-validator.js";

describe("Phase 3 (GitWhisper): Pre-Commit Shannon Entropy Secret Blocking", () => {
  it("calculates accurate Shannon entropy in bits per character", () => {
    // Repeated character has 0 entropy
    expect(calculateShannonEntropy("aaaaaaaaaaaaaaaa")).toBe(0);

    // Predictable low-entropy English word
    const lowEntropy = calculateShannonEntropy("regular_english_text_here");
    expect(lowEntropy).toBeLessThan(4.0);

    // High-entropy cryptographic token / API key
    const highEntropy = calculateShannonEntropy("dGhpcy1pcy1hLXJhbmRvbS1zZWNyZXQta2V5LTIwMjY=");
    expect(highEntropy).toBeGreaterThanOrEqual(4.5);
  });

  it("detects and flags high-entropy secret assignments in diffs", () => {
    const detector = new ShannonEntropyDetector(4.5);

    const diff = [
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -10,1 +10,1 @@",
      '+ const api_key = "x7K9#mQ2$vL5*pW8!jN4^zR1&bY6@tE3";',
    ].join("\n");

    const findings = detector.scan({ patch: diff, filePath: "src/config.ts" });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].detector).toBe("shannon-entropy");
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].placeholder).toBe("<GITWHISPER_REDACTED_HIGH_ENTROPY_SECRET>");
  });

  it("ignores UUIDs and standard git commit hashes", () => {
    const detector = new ShannonEntropyDetector(4.5);

    const diff = [
      "--- a/src/id.ts",
      "+++ b/src/id.ts",
      "@@ -1,1 +1,1 @@",
      '+ const userId = "123e4567-e89b-12d3-a456-426614174000";',
      '+ const commitSha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";',
    ].join("\n");

    const findings = detector.scan({ patch: diff, filePath: "src/id.ts" });
    expect(findings.length).toBe(0);
  });
});

describe("Phase 3 (GitWhisper): Enterprise Jira & Linear Issue Key Governance", () => {
  it("validates compliant Jira issue keys", () => {
    const validator = new EnterpriseIssueKeyValidator({ required: true, format: "jira" });

    const valid = validator.validate("feat(auth): PROJ-1234 implement enterprise SSO login");
    expect(valid.valid).toBe(true);
    expect(valid.detectedKeys).toContain("PROJ-1234");
    expect(valid.provider).toBe("jira");

    const invalid = validator.validate("feat(auth): implement enterprise SSO login without ticket");
    expect(invalid.valid).toBe(false);
    expect(invalid.error).toContain("Enterprise Policy Violation");
  });

  it("validates compliant Linear issue keys", () => {
    const validator = new EnterpriseIssueKeyValidator({ required: true, format: "linear" });

    const valid = validator.validate("fix(ui): ENG-456 resolve modal cutoff on mobile");
    expect(valid.valid).toBe(true);
    expect(valid.detectedKeys).toContain("ENG-456");

    const invalid = validator.validate("fix(ui): resolve modal cutoff on mobile");
    expect(invalid.valid).toBe(false);
  });

  it("enforces allowed enterprise project prefixes strictly", () => {
    const validator = new EnterpriseIssueKeyValidator({
      required: true,
      allowedPrefixes: ["ENG", "PROJ", "SEC"],
    });

    const allowed = validator.validate("refactor(core): SEC-890 harden wire encryption");
    expect(allowed.valid).toBe(true);

    const disallowed = validator.validate("refactor(core): RANDOM-999 harden wire encryption");
    expect(disallowed.valid).toBe(false);
    expect(disallowed.error).toContain("do not match allowed enterprise prefixes");
  });

  it("respects allowBypassWithNoTicket flag when explicit tag is used", () => {
    const validator = new EnterpriseIssueKeyValidator({
      required: true,
      allowBypassWithNoTicket: true,
    });

    const bypassed = validator.validate("docs: [no-ticket] update installation guide in README");
    expect(bypassed.valid).toBe(true);
    expect(bypassed.formattedReference).toBe("[no-ticket]");
  });
});

describe("Phase 3 (GitWhisper): Corporate LLM Gateways (Azure OpenAI & AWS Bedrock)", () => {
  it("initializes Azure OpenAI provider with tenant endpoint and deployment ID", () => {
    const azure = new AzureOpenAIProvider({
      endpoint: "https://my-enterprise.openai.azure.com",
      deploymentId: "gpt-4o-enterprise",
      apiKey: "test-azure-api-key-123",
      apiVersion: "2024-06-01",
    });

    expect(azure.id).toBe("azure-openai");
    expect(azure.isLocal).toBe(false);
    expect(azure.model).toBe("gpt-4o-enterprise");
    expect(azure.apiVersion).toBe("2024-06-01");
  });

  it("initializes AWS Bedrock provider with region and model ID", () => {
    const bedrock = new AwsBedrockProvider({
      region: "us-west-2",
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    });

    expect(bedrock.id).toBe("aws-bedrock");
    expect(bedrock.isLocal).toBe(false);
    expect(bedrock.region).toBe("us-west-2");
    expect(bedrock.baseUrl).toContain("bedrock-runtime.us-west-2.amazonaws.com");
  });
});
