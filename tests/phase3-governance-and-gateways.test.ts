import http from "node:http";
import type { CommitGenerationRequest } from "@gitwhisper/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProvider, getPrivacyBadge } from "../packages/ai/src/factory.js";
import { AwsBedrockProvider } from "../packages/ai/src/providers/aws-bedrock.js";
import { AzureOpenAIProvider } from "../packages/ai/src/providers/azure-openai.js";
import {
  ShannonEntropyDetector,
  calculateShannonEntropy,
} from "../packages/core/src/privacy/detectors/shannon-entropy.js";
import { EnterpriseIssueKeyValidator } from "../packages/core/src/workitems/enterprise-validator.js";

describe("Phase 3 (GitWhisper): Pre-Commit Shannon Entropy Secret Blocking", () => {
  it("calculates accurate Shannon entropy in bits per character", () => {
    expect(calculateShannonEntropy("aaaaaaaaaaaaaaaa")).toBe(0);

    const lowEntropy = calculateShannonEntropy("regular_english_text_here");
    expect(lowEntropy).toBeLessThan(4.0);

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
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  const dummyRequest: CommitGenerationRequest = {
    repository: { name: "test-corp-repo", branch: "main" },
    files: [{ path: "src/auth.ts", status: "modified", additions: 5, deletions: 1, binary: false }],
    stats: { additions: 5, deletions: 1 },
    patch: "+export function ssoLogin() {}\n",
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.url?.includes("/openai/deployments/gpt-4o-enterprise/chat/completions")) {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          if (body.includes("3 distinct message variants")) {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        type: "feat",
                        scope: "auth",
                        breaking: false,
                        variants: {
                          concise: {
                            style: "concise",
                            subject: "feat(auth): add sso",
                            description: "add sso",
                          },
                          descriptive: {
                            style: "descriptive",
                            subject: "feat(auth): implement enterprise sso",
                            description: "implement enterprise sso",
                          },
                          detailed: {
                            style: "detailed",
                            subject: "feat(auth): implement enterprise sso with azure",
                            description: "implement enterprise sso with azure",
                          },
                        },
                        reasoning: ["added enterprise sso"],
                      }),
                    },
                  },
                ],
              }),
            );
          } else {
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        type: "feat",
                        scope: "auth",
                        description: "implement enterprise sso",
                        subject: "feat(auth): implement enterprise sso",
                        reasoning: ["added sso"],
                        breaking: false,
                      }),
                    },
                  },
                ],
              }),
            );
          }
        });
      } else if (req.url?.includes("/model/anthropic.claude-3-5-sonnet-20241022-v2:0/invoke")) {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          if (body.includes("3 distinct message variants")) {
            res.end(
              JSON.stringify({
                content: [
                  {
                    text: JSON.stringify({
                      type: "fix",
                      scope: "sec",
                      breaking: false,
                      variants: {
                        concise: {
                          style: "concise",
                          subject: "fix(sec): patch leak",
                          description: "patch leak",
                        },
                        descriptive: {
                          style: "descriptive",
                          subject: "fix(sec): block secret leak",
                          description: "block secret leak",
                        },
                        detailed: {
                          style: "detailed",
                          subject: "fix(sec): block secret leak using shannon entropy",
                          description: "block secret leak using shannon entropy",
                        },
                      },
                      reasoning: ["blocked secret leak"],
                    }),
                  },
                ],
              }),
            );
          } else {
            res.end(
              JSON.stringify({
                content: [
                  {
                    text: JSON.stringify({
                      type: "fix",
                      scope: "sec",
                      description: "block secret leak",
                      subject: "fix(sec): block secret leak",
                      reasoning: ["blocked leak"],
                      breaking: false,
                    }),
                  },
                ],
              }),
            );
          }
        });
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not Found" }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("generates single commit and multi-variants via Azure OpenAI corporate gateway", async () => {
    const azure = new AzureOpenAIProvider({
      endpoint: baseUrl,
      deploymentId: "gpt-4o-enterprise",
      apiKey: "test-azure-api-key",
      apiVersion: "2024-06-01",
    });

    const single = await azure.generateCommitMessage(dummyRequest);
    expect(single.type).toBe("feat");
    expect(single.subject).toBe("feat(auth): implement enterprise sso");
    expect(single.provider).toBe("azure-openai");

    const multi = await azure.generateCommitVariants(dummyRequest);
    expect(multi.variants.concise.subject).toBe("feat(auth): add sso");
    expect(multi.variants.descriptive.subject).toBe("feat(auth): implement enterprise sso");
  });

  it("generates single commit and multi-variants via AWS Bedrock corporate gateway", async () => {
    const bedrock = new AwsBedrockProvider({
      endpoint: baseUrl,
      region: "us-east-1",
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      accessKeyId: "mock_access_key",
    });

    const single = await bedrock.generateCommitMessage(dummyRequest);
    expect(single.type).toBe("fix");
    expect(single.subject).toBe("fix(sec): block secret leak");
    expect(single.provider).toBe("aws-bedrock");

    const multi = await bedrock.generateCommitVariants(dummyRequest);
    expect(multi.variants.concise.subject).toBe("fix(sec): patch leak");
  });

  it("instantiates corporate providers via factory and computes privacy badges", () => {
    const azureProvider = createProvider({
      provider: "azure-openai" as any,
      baseUrl: "https://corp.openai.azure.com",
      model: "gpt-4o",
      apiKey: "secret",
    } as any);

    expect(azureProvider.id).toBe("azure-openai");
    const badge = getPrivacyBadge(azureProvider);
    expect(badge.isLocal).toBe(false);

    const bedrockProvider = createProvider({
      provider: "aws-bedrock" as any,
      baseUrl: "https://bedrock.us-east-1.amazonaws.com",
      model: "claude-3",
    } as any);

    expect(bedrockProvider.id).toBe("aws-bedrock");
  });
});
