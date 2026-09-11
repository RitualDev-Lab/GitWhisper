import { formatCommitSubject, validateCommitProposal } from "../intelligence/validator.js";
import type {
  CommitComposerSession,
  CommitVariant,
  CommitVariantStyle,
  ComposerOverrides,
  ComposerState,
  GitWhisperError,
} from "./types.js";

/**
 * Valid state transitions mapping.
 */
const VALID_TRANSITIONS: Record<ComposerState, readonly ComposerState[]> = {
  analyzing: ["reviewing", "error", "cancelled"],
  reviewing: [
    "editing",
    "selecting-type",
    "selecting-scope",
    "viewing-details",
    "viewing-patch",
    "regenerating",
    "committing",
    "cancelled",
    "error",
  ],
  editing: ["reviewing", "cancelled", "error"],
  "selecting-type": ["reviewing", "cancelled", "error"],
  "selecting-scope": ["reviewing", "cancelled", "error"],
  "viewing-details": ["reviewing", "cancelled"],
  "viewing-patch": ["reviewing", "cancelled"],
  regenerating: ["reviewing", "error", "cancelled"],
  committing: ["completed", "error", "cancelled"],
  completed: [],
  cancelled: [],
  error: ["reviewing", "regenerating", "committing", "cancelled"],
};

/**
 * Validates whether a transition from currentState to nextState is permitted.
 */
export function isValidTransition(currentState: ComposerState, nextState: ComposerState): boolean {
  if (currentState === nextState) return true;
  const allowed = VALID_TRANSITIONS[currentState];
  return allowed ? allowed.includes(nextState) : false;
}

/**
 * Transitions a composer session to a new state, enforcing state-machine integrity.
 */
export function transitionComposer(
  session: CommitComposerSession,
  nextState: ComposerState,
  error?: GitWhisperError,
): CommitComposerSession {
  if (!isValidTransition(session.state, nextState)) {
    throw new Error(
      `Illegal composer transition: cannot move from '${session.state}' to '${nextState}'.`,
    );
  }

  return {
    ...session,
    state: nextState,
    error: error ?? (nextState === "error" ? session.error : undefined),
  };
}

/**
 * Switches the active variant in the session by style (concise, descriptive, detailed).
 */
export function switchVariant(
  session: CommitComposerSession,
  targetStyle: CommitVariantStyle,
): CommitComposerSession {
  const matching = session.variants.find((v) => v.style === targetStyle);
  if (!matching) {
    return session;
  }

  return {
    ...session,
    selectedVariantId: matching.id,
  };
}

/**
 * Applies developer overrides (type, scope, breaking, manual text) to all variants in the session,
 * re-formatting subjects and re-validating deterministically.
 */
export function applyComposerOverrides(
  session: CommitComposerSession,
  overrides: Partial<ComposerOverrides>,
): CommitComposerSession {
  const mergedOverrides: ComposerOverrides = {
    ...session.overrides,
    ...overrides,
  };

  const updatedVariants = session.variants.map((variant) => {
    const activeType = mergedOverrides.type ?? variant.proposal.type;
    const activeScope =
      mergedOverrides.scope !== undefined
        ? mergedOverrides.scope || undefined
        : variant.proposal.scope;
    const activeBreaking =
      mergedOverrides.breaking !== undefined ? mergedOverrides.breaking : variant.proposal.breaking;

    const updatedProposal = {
      ...variant.proposal,
      type: activeType,
      scope: activeScope,
      breaking: activeBreaking,
    };

    const newSubject =
      mergedOverrides.manualSubject !== undefined && variant.id === session.selectedVariantId
        ? mergedOverrides.manualSubject
        : formatCommitSubject(updatedProposal);

    const newBody =
      mergedOverrides.manualBody !== undefined && variant.id === session.selectedVariantId
        ? mergedOverrides.manualBody
        : variant.body;

    const validation = validateCommitProposal(updatedProposal);

    return {
      ...variant,
      subject: newSubject,
      body: newBody,
      proposal: updatedProposal,
      validation,
    };
  });

  return {
    ...session,
    overrides: mergedOverrides,
    variants: updatedVariants,
  };
}

/**
 * Filters out duplicate or nearly identical variants to present honest choices.
 */
export function deduplicateVariants(variants: CommitVariant[]): CommitVariant[] {
  const seenSubjects = new Set<string>();
  const unique: CommitVariant[] = [];

  for (const v of variants) {
    const normalized = v.subject.trim().toLowerCase();
    if (!seenSubjects.has(normalized)) {
      seenSubjects.add(normalized);
      unique.push(v);
    }
  }

  return unique;
}

/**
 * Measures structural and content diversity across generated variants.
 * Returns a score between 0.0 (identical) and 1.0 (highly differentiated).
 */
export function calculateVariantDiversity(variants: CommitVariant[]): number {
  if (variants.length <= 1) return 1.0;

  let totalDiff = 0;
  let comparisons = 0;

  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      comparisons++;
      const vA = variants[i];
      const vB = variants[j];

      // Length difference ratio
      const lenA = (vA.subject + (vA.body ?? "")).length;
      const lenB = (vB.subject + (vB.body ?? "")).length;
      const lenRatio = Math.abs(lenA - lenB) / Math.max(lenA, lenB, 1);

      // Subject distinction
      const subjectDiff = vA.subject !== vB.subject ? 0.5 : 0.0;

      // Body distinction
      const bodyA = Boolean(vA.body && vA.body.trim().length > 0);
      const bodyB = Boolean(vB.body && vB.body.trim().length > 0);
      const bodyDiff = bodyA !== bodyB ? 0.3 : 0.0;

      totalDiff += Math.min(1.0, lenRatio * 0.4 + subjectDiff + bodyDiff);
    }
  }

  return comparisons > 0 ? Number((totalDiff / comparisons).toFixed(2)) : 1.0;
}
