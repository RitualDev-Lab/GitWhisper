import { describe, expect, it } from "vitest";
import {
  type CommitComposerSession,
  type CommitVariant,
  applyComposerOverrides,
  calculateVariantDiversity,
  deduplicateVariants,
  isValidTransition,
  switchVariant,
  transitionComposer,
} from "../../packages/core/src/composer/index.js";

function createMockSession(): CommitComposerSession {
  const vConcise: CommitVariant = {
    id: "concise",
    style: "concise",
    subject: "feat(auth): add login validation",
    proposal: {
      type: "feat",
      scope: "auth",
      description: "add login validation",
      breaking: false,
      confidence: { type: "HIGH", scope: "HIGH" },
      evidence: {
        typeReasons: ["Added login validator"],
        scopeReasons: ["auth directory"],
        signals: [],
      },
    },
    validation: { valid: true, errors: [], warnings: [] },
  };

  const vDescriptive: CommitVariant = {
    id: "descriptive",
    style: "descriptive",
    subject: "feat(auth): add email and password validation to login handler",
    body: "Ensure email format matches standard and password meets security length rules.",
    proposal: {
      type: "feat",
      scope: "auth",
      description: "add email and password validation to login handler",
      body: "Ensure email format matches standard and password meets security length rules.",
      breaking: false,
      confidence: { type: "HIGH", scope: "HIGH" },
      evidence: {
        typeReasons: ["Added login validator"],
        scopeReasons: ["auth directory"],
        signals: [],
      },
    },
    validation: { valid: true, errors: [], warnings: [] },
  };

  const vDetailed: CommitVariant = {
    id: "detailed",
    style: "detailed",
    subject: "feat(auth): implement comprehensive login payload validation with regex checks",
    body: "Validate input payloads against schema before proceeding with authentication.\nRejects malformed emails early.",
    proposal: {
      type: "feat",
      scope: "auth",
      description: "implement comprehensive login payload validation with regex checks",
      body: "Validate input payloads against schema before proceeding with authentication.\nRejects malformed emails early.",
      breaking: false,
      confidence: { type: "HIGH", scope: "HIGH" },
      evidence: {
        typeReasons: ["Added login validator"],
        scopeReasons: ["auth directory"],
        signals: [],
      },
    },
    validation: { valid: true, errors: [], warnings: [] },
  };

  return {
    id: "test-session-1",
    repository: {
      root: "/mock/repo",
      name: "test-repo",
      branch: "main",
      isDetached: false,
      hasCommits: true,
      stagedCount: 2,
      unstagedCount: 0,
      untrackedCount: 0,
    },
    changeContext: {} as any,
    variants: [vConcise, vDescriptive, vDetailed],
    selectedVariantId: "descriptive",
    overrides: {},
    evidence: [],
    timing: {
      gitAnalysisMs: 10,
      intelligenceMs: 5,
      providerMs: 250,
      totalMs: 265,
    },
    provider: {
      id: "ollama",
      model: "test-model",
      isLocal: true,
      privacyLabel: "Local",
    },
    state: "reviewing",
  };
}

describe("Composer State Machine & Invariants", () => {
  it("enforces legal state transitions and rejects illegal transitions", () => {
    const session = createMockSession();

    // Legal transitions from reviewing
    expect(isValidTransition("reviewing", "committing")).toBe(true);
    expect(isValidTransition("reviewing", "editing")).toBe(true);
    expect(isValidTransition("reviewing", "regenerating")).toBe(true);
    expect(isValidTransition("reviewing", "cancelled")).toBe(true);

    // Illegal transition: reviewing directly to completed
    expect(isValidTransition("reviewing", "completed")).toBe(false);

    // State transition application
    const committingSession = transitionComposer(session, "committing");
    expect(committingSession.state).toBe("committing");

    const completedSession = transitionComposer(committingSession, "completed");
    expect(completedSession.state).toBe("completed");

    // Attempting illegal transition throws error
    expect(() => transitionComposer(session, "completed")).toThrow(/Illegal composer transition/);
  });

  it("switches active variant by style", () => {
    const session = createMockSession();
    expect(session.selectedVariantId).toBe("descriptive");

    const conciseSession = switchVariant(session, "concise");
    expect(conciseSession.selectedVariantId).toBe("concise");

    const detailedSession = switchVariant(session, "detailed");
    expect(detailedSession.selectedVariantId).toBe("detailed");
  });

  it("applies developer overrides across all variants and re-formats subjects", () => {
    const session = createMockSession();

    const overridden = applyComposerOverrides(session, {
      type: "fix",
      scope: "security",
      breaking: true,
    });

    expect(overridden.overrides.type).toBe("fix");
    expect(overridden.overrides.scope).toBe("security");
    expect(overridden.overrides.breaking).toBe(true);

    // Check that every variant updated subject with fix(security)!:
    for (const v of overridden.variants) {
      expect(v.proposal.type).toBe("fix");
      expect(v.proposal.scope).toBe("security");
      expect(v.proposal.breaking).toBe(true);
      expect(v.subject).toMatch(/^fix\(security\)!: /);
    }
  });

  it("applies manual subject and body override only to selected variant", () => {
    const session = createMockSession();
    session.selectedVariantId = "descriptive";

    const customSubject = "fix: manually edited subject";
    const customBody = "Manually edited body text";

    const overridden = applyComposerOverrides(session, {
      manualSubject: customSubject,
      manualBody: customBody,
    });

    const active = overridden.variants.find((v) => v.id === "descriptive");
    expect(active?.subject).toBe(customSubject);
    expect(active?.body).toBe(customBody);

    // Other variants retain their imperative summaries
    const concise = overridden.variants.find((v) => v.id === "concise");
    expect(concise?.subject).not.toBe(customSubject);
  });

  it("deduplicates identical variants correctly", () => {
    const session = createMockSession();
    const duplicateVariant: CommitVariant = {
      ...session.variants[0]!,
      id: "concise-copy",
    };

    const variantsWithDupe = [...session.variants, duplicateVariant];
    expect(variantsWithDupe.length).toBe(4);

    const deduplicated = deduplicateVariants(variantsWithDupe);
    expect(deduplicated.length).toBe(3);
  });

  it("calculates variant diversity score", () => {
    const session = createMockSession();
    const diversity = calculateVariantDiversity(session.variants);

    expect(diversity).toBeGreaterThan(0.3);
    expect(diversity).toBeLessThanOrEqual(1.0);

    // Identical variants yield lower diversity
    const identical = [session.variants[0]!, session.variants[0]!];
    expect(calculateVariantDiversity(identical)).toBe(0.0);
  });
});
