import { type CommitProposal, formatCommitSubject, validateCommitProposal } from "@gitwhisper/core";
import { describe, expect, it } from "vitest";

describe("Commit Proposal Validator", () => {
  const validProposal: CommitProposal = {
    type: "feat",
    scope: "auth",
    description: "validate expired session tokens",
    body: "Rejects expired tokens during login.",
    breaking: false,
    confidence: { type: "HIGH", scope: "HIGH" },
    evidence: { typeReasons: [], scopeReasons: [], signals: [] },
  };

  it("formats conventional commit subject accurately", () => {
    expect(formatCommitSubject(validProposal)).toBe("feat(auth): validate expired session tokens");

    const noScopeProposal = { ...validProposal, scope: undefined };
    expect(formatCommitSubject(noScopeProposal)).toBe("feat: validate expired session tokens");

    const breakingProposal = { ...validProposal, breaking: true };
    expect(formatCommitSubject(breakingProposal)).toBe(
      "feat(auth)!: validate expired session tokens",
    );
  });

  it("validates a compliant proposal as valid", () => {
    const result = validateCommitProposal(validProposal);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects unknown commit types", () => {
    const invalidProposal = { ...validProposal, type: "improvement" };
    const result = validateCommitProposal(invalidProposal);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_TYPE")).toBe(true);
  });

  it("rejects vague commit descriptions", () => {
    const vagueProposal = { ...validProposal, description: "update files" };
    const result = validateCommitProposal(vagueProposal);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "VAGUE_DESCRIPTION")).toBe(true);
  });

  it("enforces requireScope rule when configured", () => {
    const noScopeProposal = { ...validProposal, scope: undefined };
    const result = validateCommitProposal(noScopeProposal, { requireScope: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "SCOPE_REQUIRED")).toBe(true);
  });

  it("warns when subject length exceeds recommended 72 characters", () => {
    const longProposal = {
      ...validProposal,
      description: "this is a subject line that moderately exceeds seventy-two characters limit",
    };
    const result = validateCommitProposal(longProposal, { maxSubjectLength: 72 });
    expect(result.warnings.some((w) => w.code === "SUBJECT_LENGTH_WARNING")).toBe(true);
  });

  it("errors when subject length exceeds 100 characters", () => {
    const veryLongProposal = {
      ...validProposal,
      description:
        "this is an excessively long subject line that easily exceeds one hundred total characters in the final commit message line",
    };
    const result = validateCommitProposal(veryLongProposal, { maxSubjectLength: 72 });
    expect(result.errors.some((e) => e.code === "SUBJECT_TOO_LONG")).toBe(true);
  });

  it("strips trailing period from subject formatting", () => {
    const periodProposal = { ...validProposal, description: "add new endpoint." };
    const formatted = formatCommitSubject(periodProposal);
    expect(formatted.endsWith(".")).toBe(false);
  });
});
