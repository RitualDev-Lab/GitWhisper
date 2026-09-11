import { describe, expect, it } from "vitest";
import { checkCommitQuality, parseCommitMessage } from "@gitwhisper/core";
import type { CommitPolicy } from "@gitwhisper/core";

const defaultPolicy: CommitPolicy = {
  style: "conventional",
  allowedTypes: [
    "feat",
    "fix",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ],
  scopes: ["auth", "api", "ui", "cli", "core", "config"],
  requiredScopes: [],
  strictScopes: false,
  maxSubjectLength: 72,
  requireScope: false,
  requireWorkItem: false,
  workItemMode: "reference",
  allowVagueDescriptions: false,
};

describe("parseCommitMessage", () => {
  it("parses conventional commit with type and scope", () => {
    const parsed = parseCommitMessage("feat(auth): add OAuth2 refresh token handling");
    expect(parsed.type).toBe("feat");
    expect(parsed.scope).toBe("auth");
    expect(parsed.breaking).toBe(false);
    expect(parsed.description).toBe("add OAuth2 refresh token handling");
  });

  it("parses breaking change mark in conventional syntax", () => {
    const parsed = parseCommitMessage(
      "feat(api)!: remove legacy v1 endpoints\n\nBREAKING CHANGE: v1 API is removed.",
    );
    expect(parsed.type).toBe("feat");
    expect(parsed.scope).toBe("api");
    expect(parsed.breaking).toBe(true);
    expect(parsed.body).toContain("v1 API is removed.");
  });

  it("strips comment lines starting with #", () => {
    const raw =
      "fix(core): handle null pointer\n# Please enter commit message\n# Lines starting with # are ignored\n\nResolves issue #42";
    const parsed = parseCommitMessage(raw);
    expect(parsed.subject).toBe("fix(core): handle null pointer");
    expect(parsed.body).toBe("Resolves issue #42");
  });
});

describe("checkCommitQuality", () => {
  it("rates an excellent, well-formed conventional commit as excellent", async () => {
    const result = await checkCommitQuality({
      message:
        "feat(auth): add OAuth2 refresh token rotation\n\nRotates tokens automatically upon expiry.",
      policy: defaultPolicy,
    });

    expect(result.valid).toBe(true);
    expect(result.rating).toBe("excellent");
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("detects and flags vague commit descriptions", async () => {
    const vagueMessages = [
      "feat(ui): update stuff",
      "fix(cli): fix bug",
      "chore: wip",
      "refactor(core): misc changes",
      "docs: update code",
    ];

    for (const msg of vagueMessages) {
      const result = await checkCommitQuality({
        message: msg,
        policy: defaultPolicy,
      });

      const vagueIssue = result.issues.find((i) => i.code === "VAGUE_DESCRIPTION");
      expect(vagueIssue, `Expected VAGUE_DESCRIPTION for "${msg}"`).toBeDefined();
      expect(vagueIssue?.severity).toBe("warning");
    }
  });

  it("allows vague descriptions if policy explicitly allows them", async () => {
    const result = await checkCommitQuality({
      message: "feat(ui): update stuff",
      policy: { ...defaultPolicy, allowVagueDescriptions: true },
    });

    const vagueIssue = result.issues.find((i) => i.code === "VAGUE_DESCRIPTION");
    expect(vagueIssue).toBeUndefined();
  });

  it("detects invalid conventional types", async () => {
    const result = await checkCommitQuality({
      message: "feature(auth): add login form",
      policy: defaultPolicy,
    });

    expect(result.valid).toBe(false);
    const typeIssue = result.issues.find((i) => i.code === "INVALID_TYPE");
    expect(typeIssue).toBeDefined();
    expect(typeIssue?.severity).toBe("error");
  });

  it("enforces requireScope policy", async () => {
    const result = await checkCommitQuality({
      message: "feat: add login form",
      policy: { ...defaultPolicy, requireScope: true },
    });

    expect(result.valid).toBe(false);
    const scopeIssue = result.issues.find((i) => i.code === "MISSING_SCOPE");
    expect(scopeIssue).toBeDefined();
    expect(scopeIssue?.severity).toBe("error");
  });

  it("enforces strictScopes against allowed scope list", async () => {
    const result = await checkCommitQuality({
      message: "feat(unknownScope): add login form",
      policy: { ...defaultPolicy, strictScopes: true, scopes: ["auth", "cli"] },
    });

    expect(result.valid).toBe(false);
    const scopeIssue = result.issues.find((i) => i.code === "DISALLOWED_SCOPE");
    expect(scopeIssue).toBeDefined();
  });

  it("enforces requiredScopes whitelist if configured", async () => {
    const result = await checkCommitQuality({
      message: "feat(other): add login form",
      policy: { ...defaultPolicy, requiredScopes: ["auth", "cli"] },
    });

    expect(result.valid).toBe(false);
    const scopeIssue = result.issues.find((i) => i.code === "DISALLOWED_SCOPE");
    expect(scopeIssue).toBeDefined();
  });

  it("detects subjects exceeding maxSubjectLength", async () => {
    const longSubject = `feat(auth): ${"a".repeat(70)}`;
    const result = await checkCommitQuality({
      message: longSubject,
      policy: { ...defaultPolicy, maxSubjectLength: 50 },
    });

    const lengthIssue = result.issues.find((i) => i.code === "SUBJECT_TOO_LONG");
    expect(lengthIssue).toBeDefined();
    expect(lengthIssue?.severity).toBe("warning");
  });

  it("detects trailing punctuation in subject", async () => {
    const result = await checkCommitQuality({
      message: "feat(auth): add login form.",
      policy: defaultPolicy,
    });

    const punctIssue = result.issues.find((i) => i.code === "TRAILING_PUNCTUATION");
    expect(punctIssue).toBeDefined();
  });

  it("flags breaking change indicator without explanation", async () => {
    const result = await checkCommitQuality({
      message: "feat(api)!: change user response shape",
      policy: defaultPolicy,
    });

    const breakingIssue = result.issues.find((i) => i.code === "MISSING_BREAKING_DETAILS");
    expect(breakingIssue).toBeDefined();
    expect(breakingIssue?.severity).toBe("warning");
  });

  it("enforces requireWorkItem policy", async () => {
    const withoutTicket = await checkCommitQuality({
      message: "feat(auth): add login form",
      policy: { ...defaultPolicy, requireWorkItem: true },
    });

    expect(withoutTicket.valid).toBe(false);
    const itemIssue = withoutTicket.issues.find((i) => i.code === "MISSING_WORK_ITEM");
    expect(itemIssue).toBeDefined();

    const withTicket = await checkCommitQuality({
      message: "feat(auth): add login form (DEV-142)",
      policy: { ...defaultPolicy, requireWorkItem: true },
    });

    expect(withTicket.issues.find((i) => i.code === "MISSING_WORK_ITEM")).toBeUndefined();
  });

  it("detects secrets in commit message and issues blocking error", async () => {
    const syntheticGhp = ["ghp", "123456789012345678901234567890123456"].join("_");
    const result = await checkCommitQuality({
      message: `fix(auth): update token to ${syntheticGhp}`,
      policy: defaultPolicy,
    });

    expect(result.valid).toBe(false);
    const secretIssue = result.issues.find((i) => i.code === "SECRET_IN_COMMIT_MESSAGE");
    expect(secretIssue).toBeDefined();
    expect(secretIssue?.severity).toBe("error");
  });

  it("rejects empty commit message", async () => {
    const result = await checkCommitQuality({
      message: "   \n# Only comments\n   ",
      policy: defaultPolicy,
    });

    expect(result.valid).toBe(false);
    expect(result.rating).toBe("poor");
    const emptyIssue = result.issues.find((i) => i.code === "EMPTY_MESSAGE");
    expect(emptyIssue).toBeDefined();
  });

  it("produces suggested message fixing minor issues", async () => {
    const result = await checkCommitQuality({
      message: "feat(auth): add login form.",
      policy: defaultPolicy,
    });

    expect(result.suggestedMessage).toBeDefined();
    expect(result.suggestedMessage?.endsWith(".")).toBe(false);
  });
});
