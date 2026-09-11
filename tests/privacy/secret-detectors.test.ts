import {
  AuthorizationHeaderDetector,
  ConnectionStringDetector,
  CustomPatternDetector,
  EnvironmentFileDetector,
  JwtDetector,
  KnownFormatDetector,
  PrivateKeyDetector,
  VariableHeuristicDetector,
  createDefaultDetectors,
} from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Phase 7 Secret Detectors", () => {
  it("detects PEM private key headers in added and deleted lines (PrivateKeyDetector)", () => {
    const detector = new PrivateKeyDetector();
    const patch = `
diff --git a/certs/server.key b/certs/server.key
--- a/certs/server.key
+++ b/certs/server.key
@@ -1,3 +1,3 @@
------BEGIN RSA PRIVATE KEY-----
+-----BEGIN OPENSSH PRIVATE KEY-----
 MIIEowIBAAKCAQEA0synthetic...
`;
    const findings = detector.scan({ patch, filePath: "certs/server.key" });
    expect(findings.length).toBeGreaterThanOrEqual(2);

    const deleted = findings.find((f) => f.lineType === "deleted");
    expect(deleted).toBeDefined();
    expect(deleted?.category).toBe("private-key");
    expect(deleted?.confidence).toBe("high");
    expect(deleted?.matchedText).toContain("BEGIN RSA PRIVATE KEY");
    expect(deleted?.maskedPreview).toBe("-----BEGIN [REDACTED PRIVATE KEY]-----");

    const added = findings.find((f) => f.lineType === "added");
    expect(added).toBeDefined();
    expect(added?.category).toBe("private-key");
    expect(added?.confidence).toBe("high");
  });

  it("detects Authorization header tokens while preserving header format (AuthorizationHeaderDetector)", () => {
    const detector = new AuthorizationHeaderDetector();
    const patch = `
diff --git a/src/client.ts b/src/client.ts
@@ -10,2 +10,2 @@
-  headers: { Authorization: "Bearer synthetic_old_token_12345678" }
+  headers: { Authorization: "Bearer synthetic_secret_token_abcdef987654321" }
`;
    const findings = detector.scan({ patch, filePath: "src/client.ts" });
    expect(findings).toHaveLength(2);

    const added = findings.find((f) => f.lineType === "added");
    expect(added).toBeDefined();
    expect(added?.category).toBe("authorization-header");
    expect(added?.matchedText).toBe("synthetic_secret_token_abcdef987654321");
    expect(added?.placeholder).toBe("<GITWHISPER_REDACTED_AUTH_TOKEN>");
    expect(added?.maskedPreview).toMatch(/synt\*\*\*\*4321/);
  });

  it("detects AWS, GitHub, Stripe, Slack, and OpenAI credentials (KnownFormatDetector)", () => {
    const detector = new KnownFormatDetector();
    const ghpKey = ["ghp", "111122223333444455556666777788889999"].join("_");
    const stripeKey = ["sk", "live", "syntheticTestKey1234567890123456"].join("_");
    const slackKey = ["xoxb", "123456789012", "123456789012", "syntheticSlackToken1234"].join("-");
    const openaiKey = ["sk", "syntheticOpenAiTestKey32charactersLongHere"].join("-");
    const patch = `
diff --git a/config.json b/config.json
@@ -1,5 +1,5 @@
+  "aws_key": "AKIAIOSFODNN7EXAMPLE",
+  "github": "${ghpKey}",
+  "stripe": "${stripeKey}",
+  "slack": "${slackKey}",
+  "openai": "${openaiKey}"
+`;
    const findings = detector.scan({ patch, filePath: "config.json" });
    expect(findings.length).toBeGreaterThanOrEqual(5);

    const awsFinding = findings.find((f) => f.category === "cloud-credential");
    expect(awsFinding).toBeDefined();
    expect(awsFinding?.matchedText).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(awsFinding?.placeholder).toBe("<GITWHISPER_REDACTED_AWS_KEY>");

    const githubFinding = findings.find(
      (f) => f.placeholder === "<GITWHISPER_REDACTED_GITHUB_TOKEN>",
    );
    expect(githubFinding).toBeDefined();

    const stripeFinding = findings.find(
      (f) => f.placeholder === "<GITWHISPER_REDACTED_STRIPE_KEY>",
    );
    expect(stripeFinding).toBeDefined();

    const slackFinding = findings.find(
      (f) => f.placeholder === "<GITWHISPER_REDACTED_SLACK_TOKEN>",
    );
    expect(slackFinding).toBeDefined();

    const openaiFinding = findings.find((f) => f.placeholder === "<GITWHISPER_REDACTED_API_KEY>");
    expect(openaiFinding).toBeDefined();
  });

  it("detects JWT tokens accurately (JwtDetector)", () => {
    const detector = new JwtDetector();
    // Valid 3-part synthetic JWT
    const syntheticJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const patch = `
diff --git a/test.ts b/test.ts
@@ -1 +1 @@
+const token = "${syntheticJwt}";
`;
    const findings = detector.scan({ patch, filePath: "test.ts" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("jwt");
    expect(findings[0]?.confidence).toBe("high");
    expect(findings[0]?.matchedText).toBe(syntheticJwt);
    expect(findings[0]?.placeholder).toBe("<GITWHISPER_REDACTED_JWT>");
  });

  it("detects Database connection strings and isolates password (ConnectionStringDetector)", () => {
    const detector = new ConnectionStringDetector();
    const patch = `
diff --git a/orm.config.ts b/orm.config.ts
@@ -1 +1 @@
+const uri = "postgres://postgres:SuperSecretPassword123!@db.production.internal:5432/app";
`;
    const findings = detector.scan({ patch, filePath: "orm.config.ts" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("connection-string");
    expect(findings[0]?.matchedText).toBe("SuperSecretPassword123!");
    expect(findings[0]?.placeholder).toBe("<GITWHISPER_REDACTED_PASSWORD>");
  });

  it("detects environment secrets in .env files and ignores placeholders (EnvironmentFileDetector)", () => {
    const detector = new EnvironmentFileDetector();
    const patch = `
diff --git a/.env b/.env
@@ -1,3 +1,3 @@
-API_KEY=YOUR_KEY_HERE
+API_KEY=synthetic_prod_live_key_987654321
+DB_PASSWORD=SuperSecretDatabasePass123
`;
    const findings = detector.scan({ patch, filePath: ".env" });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.category === "environment-secret")).toBe(true);
    // YOUR_KEY_HERE was ignored as a placeholder
    expect(findings.some((f) => f.matchedText === "YOUR_KEY_HERE")).toBe(false);
  });

  it("uses Shannon entropy to differentiate secrets from variable names (VariableHeuristicDetector)", () => {
    const detector = new VariableHeuristicDetector();
    const patch = `
diff --git a/src/service.ts b/src/service.ts
@@ -1,3 +1,3 @@
+const dummyApiKey = "placeholder_key";
+const secretKey = "k8F$9pQ!2wZ#vL4mX7rT";
`;
    const findings = detector.scan({ patch, filePath: "src/service.ts" });
    // High entropy secret should be detected
    const detected = findings.find((f) => f.matchedText === "k8F$9pQ!2wZ#vL4mX7rT");
    expect(detected).toBeDefined();
    expect(detected?.confidence).toBe("medium");

    // Placeholder should be ignored
    expect(findings.some((f) => f.matchedText === "placeholder_key")).toBe(false);
  });

  it("evaluates custom user-defined regex patterns (CustomPatternDetector)", () => {
    const detector = new CustomPatternDetector([
      {
        name: "internal-corp-token",
        pattern: "CORP-[0-9a-f]{16}",
        category: "generic-secret",
        confidence: "high",
      },
    ]);

    const patch = `
diff --git a/src/auth.ts b/src/auth.ts
@@ -1 +1 @@
+const corpToken = "CORP-0123456789abcdef";
`;
    const findings = detector.scan({ patch, filePath: "src/auth.ts" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detector).toBe("custom-pattern");
    expect(findings[0]?.matchedText).toBe("CORP-0123456789abcdef");
    expect(findings[0]?.description).toContain("internal-corp-token");
  });

  it("aggregates all default detectors smoothly", () => {
    const detectors = createDefaultDetectors();
    expect(detectors.length).toBe(8);
  });
});
