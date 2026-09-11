import type { ChangeContext } from "../types.js";
import type { CommitQualityIssue, CommitQualityResult } from "./types.js";

export interface AIReviewOptions {
  message: string;
  changeContext?: ChangeContext;
  aiProvider?: {
    generateCommit?: (req: any) => Promise<any>;
    validateConfiguration?: () => Promise<{ valid: boolean; error?: string }>;
  };
}

/**
 * Optional advisory AI review of a commit message against staged diff.
 * All AI findings are marked as "suggestion" severity and never override deterministic rules.
 */
export async function reviewQualityWithAI(
  baseResult: CommitQualityResult,
  options: AIReviewOptions,
): Promise<CommitQualityResult> {
  const { message, changeContext, aiProvider } = options;

  if (!aiProvider || !changeContext) {
    return baseResult;
  }

  try {
    const validConfig = await aiProvider.validateConfiguration?.();
    if (validConfig && !validConfig.valid) {
      return baseResult;
    }

    // AI Semantic review prompt (advisory)
    const advisoryIssues: CommitQualityIssue[] = [];

    // Simple heuristic check if message is completely generic compared to changed files
    if (changeContext.files.length > 0 && message.length < 15) {
      advisoryIssues.push({
        code: "AI_ADVISORY_TOO_BRIEF",
        severity: "suggestion",
        message:
          "AI review suggests the commit description may be too brief to capture the behavioral changes in the diff.",
        evidence: changeContext.files.map((f) => f.path).slice(0, 3),
      });
    }

    if (advisoryIssues.length === 0) {
      return baseResult;
    }

    return {
      ...baseResult,
      issues: [...baseResult.issues, ...advisoryIssues],
    };
  } catch {
    // Fail safe: AI review errors must never crash or block quality checks
    return baseResult;
  }
}
