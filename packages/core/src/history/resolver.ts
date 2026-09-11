import type { ChangeContext } from "../types.js";
import type { DecisionProvenance, RepositoryCommitStyle, SubjectCase } from "./types.js";

export interface ResolveStyleConfig {
  style: "auto" | "conventional" | "simple";
  maxSubjectLength: number;
  requireScope: boolean;
  body: "auto" | "always" | "never";
  allowedTypes: string[];
  scopes?: string[];
  strictScopes?: boolean;
  allowVagueDescriptions?: boolean;
  learnScopes?: boolean;
  learnFormatting?: boolean;
}

export interface ResolveCommitStyleOptions {
  config: ResolveStyleConfig;
  context: ChangeContext;
  historyProfile: RepositoryCommitStyle;
  userOverrides?: {
    forcedType?: string;
    forcedScope?: string;
    breaking?: boolean;
  };
}

export interface ResolvedCommitStyle {
  effectiveStyle: "conventional" | "simple";
  subjectCase: SubjectCase;
  targetLength: number;
  preferBody: boolean;
  suggestedScopes: string[];
  allowedTypes: string[];
  representativeExamples: string[];
  provenance: DecisionProvenance[];
}

/**
 * Merges user overrides, configuration, current staged evidence, and historical repository conventions
 * according to the strict GitWhisper precedence hierarchy.
 */
export function resolveCommitStyle(options: ResolveCommitStyleOptions): ResolvedCommitStyle {
  const { config, context, historyProfile, userOverrides } = options;
  const provenance: DecisionProvenance[] = [];

  // 1. Resolve Effective Style (conventional vs simple)
  let effectiveStyle: "conventional" | "simple" = "conventional";

  if (userOverrides?.forcedType) {
    effectiveStyle = "conventional";
    provenance.push({
      field: "style",
      decision: "conventional",
      source: "user",
      evidence: [`Explicit type override "${userOverrides.forcedType}" provided by developer`],
    });
  } else if (config.style !== "auto") {
    effectiveStyle = config.style;
    provenance.push({
      field: "style",
      decision: config.style,
      source: "config",
      evidence: [`Explicit configuration: commit.style = "${config.style}"`],
    });
  } else {
    // Auto style mode
    if (
      historyProfile.convention.style === "simple" &&
      historyProfile.convention.confidence !== "LOW"
    ) {
      effectiveStyle = "simple";
      provenance.push({
        field: "style",
        decision: "simple",
        source: "history",
        evidence: [
          `Learned from ${historyProfile.sampleSize} commits (${Math.round((1 - historyProfile.convention.conventionalRatio) * 100)}% non-conventional / simple subjects)`,
        ],
      });
    } else if (
      historyProfile.convention.style === "conventional" &&
      historyProfile.convention.confidence !== "LOW"
    ) {
      effectiveStyle = "conventional";
      provenance.push({
        field: "style",
        decision: "conventional",
        source: "history",
        evidence: [
          `Learned from ${historyProfile.sampleSize} commits (${Math.round(historyProfile.convention.conventionalRatio * 100)}% conventional commits)`,
        ],
      });
    } else {
      effectiveStyle = "conventional";
      provenance.push({
        field: "style",
        decision: "conventional",
        source: "default",
        evidence: [
          historyProfile.sampleSize < 5
            ? `Not enough history (${historyProfile.sampleSize} commits); using default conventional style`
            : "Mixed or unknown repository style; using default conventional style",
        ],
      });
    }
  }

  // 2. Resolve Type & Allowed Types
  let allowedTypes = config.allowedTypes;
  const topType = context.intelligence.probableTypes[0] || {
    type: "chore",
    score: 0.1,
    reasons: ["Default candidate"],
    confidence: "LOW",
  };

  if (userOverrides?.forcedType) {
    provenance.push({
      field: "type",
      decision: userOverrides.forcedType,
      source: "user",
      evidence: [`User selected type "${userOverrides.forcedType}"`],
    });
  } else if (topType.confidence === "HIGH") {
    // Current staged facts strictly constrain type
    if (topType.type === "docs") allowedTypes = ["docs", "chore"];
    else if (topType.type === "test") allowedTypes = ["test", "chore"];
    else if (topType.type === "ci") allowedTypes = ["ci", "chore"];
    else if (topType.type === "build") allowedTypes = ["build", "chore"];

    provenance.push({
      field: "type",
      decision: topType.type,
      source: "git",
      evidence: topType.reasons,
    });
  } else {
    provenance.push({
      field: "type",
      decision: topType.type,
      source: "git",
      evidence: topType.reasons,
    });
  }

  // 3. Resolve Scope & Suggested Scopes
  const suggestedScopesSet = new Set<string>();

  // Add configured scopes
  if (config.scopes && config.scopes.length > 0) {
    for (const s of config.scopes) suggestedScopesSet.add(s);
  }

  // Check historical path-to-scope mappings if learnScopes is enabled
  let historyScopeEvidence: string | undefined;
  let topScopeDecision = "none";
  let topScopeSource: DecisionProvenance["source"] = "default";

  if (config.learnScopes !== false && historyProfile.pathScopeMappings.length > 0) {
    for (const mapping of historyProfile.pathScopeMappings) {
      const match = context.files.some((f) =>
        f.path.replace(/\\/g, "/").startsWith(mapping.pathPrefix),
      );
      if (match) {
        suggestedScopesSet.add(mapping.scope);
        if (mapping.confidence === "HIGH" && !historyScopeEvidence) {
          historyScopeEvidence = `Historical path correlation: ${mapping.pathPrefix} -> ${mapping.scope} (${mapping.observations} commits)`;
          topScopeDecision = mapping.scope;
          topScopeSource = "history";
        }
      }
    }
  }

  // Add structural scope candidates from current files
  for (const s of context.intelligence.probableScopes) {
    if (s.scope !== "none") {
      suggestedScopesSet.add(s.scope);
      if (topScopeDecision === "none" && s.confidence === "HIGH") {
        topScopeDecision = s.scope;
        topScopeSource = "git";
      }
    }
  }

  // Add top historical scopes
  if (config.learnScopes !== false) {
    for (const sf of historyProfile.scopes.slice(0, 5)) {
      suggestedScopesSet.add(sf.scope);
    }
  }

  if (userOverrides?.forcedScope) {
    provenance.push({
      field: "scope",
      decision: userOverrides.forcedScope,
      source: "user",
      evidence: [`User selected scope "${userOverrides.forcedScope}"`],
    });
  } else if (historyScopeEvidence) {
    provenance.push({
      field: "scope",
      decision: topScopeDecision,
      source: topScopeSource,
      evidence: [historyScopeEvidence],
    });
  } else if (
    context.intelligence.probableScopes[0]?.scope &&
    context.intelligence.probableScopes[0].scope !== "none"
  ) {
    const top = context.intelligence.probableScopes[0];
    provenance.push({
      field: "scope",
      decision: top.scope,
      source: "git",
      evidence: top.reasons,
    });
  } else {
    provenance.push({
      field: "scope",
      decision: "none",
      source: "default",
      evidence: ["No specific scope identified across files or history"],
    });
  }

  // 4. Resolve Subject Casing
  let subjectCase: SubjectCase = "lowercase";
  if (config.learnFormatting === false) {
    subjectCase = "lowercase";
    provenance.push({
      field: "casing",
      decision: "lowercase",
      source: "config",
      evidence: ["Formatting learning disabled in config"],
    });
  } else if (
    historyProfile.formatting.subjectCase !== "mixed" &&
    historyProfile.formatting.subjectCase !== "unknown" &&
    historyProfile.convention.confidence !== "LOW"
  ) {
    subjectCase = historyProfile.formatting.subjectCase;
    provenance.push({
      field: "casing",
      decision: subjectCase,
      source: "history",
      evidence: [`Learned from ${historyProfile.sampleSize} historical subjects`],
    });
  } else {
    subjectCase = "lowercase";
    provenance.push({
      field: "casing",
      decision: "lowercase",
      source: "default",
      evidence: ["Default lowercase subject casing"],
    });
  }

  // 5. Subject Target Length (Config beats history)
  let targetLength = config.maxSubjectLength;
  if (
    config.learnFormatting !== false &&
    historyProfile.formatting.medianSubjectLength > 0 &&
    historyProfile.convention.confidence !== "LOW"
  ) {
    targetLength = Math.min(
      config.maxSubjectLength,
      historyProfile.formatting.medianSubjectLength + 10,
    );
    provenance.push({
      field: "length",
      decision: `Target ~${historyProfile.formatting.medianSubjectLength} chars (max ${config.maxSubjectLength})`,
      source: "history",
      evidence: [
        `Historical median subject length: ${historyProfile.formatting.medianSubjectLength} chars`,
      ],
    });
  } else {
    provenance.push({
      field: "length",
      decision: `Max ${config.maxSubjectLength} chars`,
      source: "config",
      evidence: [`commit.maxSubjectLength = ${config.maxSubjectLength}`],
    });
  }

  // 6. Body Usage Preference
  let preferBody = false;
  if (config.body === "always") {
    preferBody = true;
    provenance.push({
      field: "body",
      decision: "always",
      source: "config",
      evidence: ['Explicit configuration: commit.body = "always"'],
    });
  } else if (config.body === "never") {
    preferBody = false;
    provenance.push({
      field: "body",
      decision: "never",
      source: "config",
      evidence: ['Explicit configuration: commit.body = "never"'],
    });
  } else {
    preferBody =
      historyProfile.convention.confidence !== "LOW" &&
      historyProfile.formatting.bodyUsageFrequency >= 0.4;
    provenance.push({
      field: "body",
      decision: preferBody ? "preferred" : "omitted",
      source: "history",
      evidence: [
        `Historical bodies used in ${Math.round(historyProfile.formatting.bodyUsageFrequency * 100)}% of commits`,
      ],
    });
  }

  // Filter representative examples
  const representativeExamples = historyProfile.examples.map((e) => e.subject);

  return {
    effectiveStyle,
    subjectCase,
    targetLength,
    preferBody,
    suggestedScopes: Array.from(suggestedScopesSet),
    allowedTypes,
    representativeExamples,
    provenance,
  };
}
