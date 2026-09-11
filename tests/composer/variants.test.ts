import { describe, expect, it } from "vitest";
import { validateCommitVariantsResponse } from "../../packages/ai/src/validator.js";

describe("Multi-Variant Response Parsing & Synthesis", () => {
  it("parses full 3-variant JSON response from model", () => {
    const rawJson = JSON.stringify({
      type: "feat",
      scope: "auth",
      breaking: false,
      variants: {
        concise: {
          description: "add password strength validation",
          body: "",
        },
        descriptive: {
          description: "add password strength validation to signup handler",
          body: "Ensure passwords have at least 8 chars and mixed casing.",
        },
        detailed: {
          description:
            "implement robust password entropy validation with informative error messages",
          body: "Validates complexity rules before persisting credentials.\nPrevents weak passwords.",
        },
      },
      reasoning: ["Added zxcvbn check in auth.ts", "Updated signup schema"],
    });

    const result = validateCommitVariantsResponse(rawJson, "test-provider");

    expect(result.type).toBe("feat");
    expect(result.scope).toBe("auth");
    expect(result.breaking).toBe(false);

    // Concise
    expect(result.variants.concise.subject).toBe("feat(auth): add password strength validation");
    expect(result.variants.concise.body).toBeUndefined();

    // Descriptive
    expect(result.variants.descriptive.subject).toBe(
      "feat(auth): add password strength validation to signup handler",
    );
    expect(result.variants.descriptive.body).toBe(
      "Ensure passwords have at least 8 chars and mixed casing.",
    );

    // Detailed
    expect(result.variants.detailed.subject).toBe(
      "feat(auth): implement robust password entropy validation with informative error messages",
    );
    expect(result.variants.detailed.body).toContain("Validates complexity rules");
  });

  it("gracefully synthesizes 3 variants from legacy single-commit model output", () => {
    const legacyJson = JSON.stringify({
      type: "fix",
      scope: "db",
      description: "resolve connection timeout on pool acquisition",
      body: "Increase timeout threshold to 5000ms to handle intermittent latency spikes.",
      breaking: false,
      reasoning: ["Increased acquireTimeoutMillis in pool config"],
    });

    const result = validateCommitVariantsResponse(legacyJson, "legacy-provider");

    expect(result.type).toBe("fix");
    expect(result.scope).toBe("db");

    // All 3 variants are synthesized deterministically
    expect(result.variants.concise).toBeDefined();
    expect(result.variants.descriptive).toBeDefined();
    expect(result.variants.detailed).toBeDefined();

    expect(result.variants.descriptive.subject).toBe(
      "fix(db): resolve connection timeout on pool acquisition",
    );
    expect(result.variants.descriptive.body).toContain("Increase timeout threshold");

    expect(result.variants.concise.subject).toContain("fix(db):");
    expect(result.variants.concise.body).toBeUndefined();
  });

  it("handles markdown code fences in model output", () => {
    const fencedJson = `
\`\`\`json
{
  "type": "refactor",
  "scope": "router",
  "variants": {
    "concise": { "description": "simplify route registration" },
    "descriptive": { "description": "simplify route registration using map" },
    "detailed": { "description": "refactor route definitions into modular registry map" }
  },
  "reasoning": ["Consolidated switch cases into Map lookup"]
}
\`\`\`
`;

    const result = validateCommitVariantsResponse(fencedJson, "fenced-provider");
    expect(result.type).toBe("refactor");
    expect(result.scope).toBe("router");
    expect(result.variants.concise.subject).toBe("refactor(router): simplify route registration");
  });

  it("formats variants in simple style without conventional prefixes when requested", () => {
    const rawJson = JSON.stringify({
      variants: {
        concise: { description: "Add dark mode toggle" },
        descriptive: { description: "Add dark mode toggle to navigation header" },
        detailed: {
          description: "Implement persistent dark mode toggle with CSS custom properties",
        },
      },
      reasoning: ["Added toggle switch component"],
    });

    const result = validateCommitVariantsResponse(rawJson, "simple-provider", undefined, "simple");

    // Simple style subjects do not have type(scope): prefix
    expect(result.variants.concise.subject).toBe("Add dark mode toggle");
    expect(result.variants.descriptive.subject).toBe("Add dark mode toggle to navigation header");
    expect(result.variants.detailed.subject).toBe(
      "Implement persistent dark mode toggle with CSS custom properties",
    );
  });
});
