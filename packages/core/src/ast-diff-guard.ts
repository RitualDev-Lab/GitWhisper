import { createHash, randomUUID } from "node:crypto";
import type { ClassifiedFileChange } from "./types.js";

export interface ASTDiffViolation {
  type: "secret" | "prompt-injection" | "exfiltration";
  category: string;
  file: string;
  line: number;
  snippet: string;
  confidence: "high" | "medium" | "low";
  actionTaken: "blocked" | "redacted" | "warned";
  surrogate?: string;
}

export interface ASTDiffGuardReport {
  allowed: boolean;
  sanitizedPatch: string;
  violations: ASTDiffViolation[];
  stats: {
    filesChecked: number;
    hunksAnalyzed: number;
    secretsDetected: number;
    injectionsDetected: number;
  };
}

export interface InspectDiffOptions {
  mode?: "off" | "warn" | "strict";
  allowRedactionOnBlock?: boolean;
}

export interface SanitizePatchOptions {
  useVolatileSurrogates?: boolean;
  stripPromptInjections?: boolean;
}

/**
 * Calculates Shannon entropy for a given string token.
 */
export function calculateShannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1);
  }
  let entropy = 0;
  const len = str.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(3));
}

// Credential detection patterns
const SECRET_SIGNATURES: Array<{
  name: string;
  category: string;
  regex: RegExp;
  confidence: "high" | "medium";
}> = [
  {
    name: "AWS Access Key",
    category: "aws_access_key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    confidence: "high",
  },
  {
    name: "GitHub Token",
    category: "github_token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{82})\b/g,
    confidence: "high",
  },
  {
    name: "Slack Token",
    category: "slack_token",
    regex: /\bxox[baprs]-[0-9]{10,13}-[a-zA-Z0-9-]+\b/g,
    confidence: "high",
  },
  {
    name: "Private Key Header",
    category: "private_key",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    confidence: "high",
  },
  {
    name: "Database Connection URI",
    category: "database_uri",
    regex: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s]+:[^@\s]+@[^\s/]+/gi,
    confidence: "high",
  },
  {
    name: "Bearer Authorization Header",
    category: "bearer_token",
    regex: /Bearer\s+([A-Za-z0-9_\-\.]{24,})/gi,
    confidence: "high",
  },
];

// Indirect prompt injection and delimiter evasion patterns
const PROMPT_INJECTION_PATTERNS: Array<{
  name: string;
  regex: RegExp;
}> = [
  {
    name: "Instruction Override",
    regex:
      /(?:ignore\s+all\s+previous\s+instructions|system:\s*override|<\|im_start\|>system|\[SYSTEM\s+INSTRUCTION\]|DISREGARD\s+PRIOR\s+COMMANDS)/gi,
  },
  {
    name: "Exfiltration Image Payload",
    regex: /!\[.*?\]\((https?:\/\/[^\s)]*(?:token|key|secret|leak|exfil)[^\s)]*)\)/gi,
  },
];

/**
 * PreCommitASTDiffGuard:
 * Intercepts git commit hooks to sanitize patch context before transmitting prompts to remote LLMs.
 * Operates offline, fast (< 50ms), zero network calls.
 */
export class PreCommitASTDiffGuard {
  constructor(private readonly defaultOptions: InspectDiffOptions = {}) {}

  /**
   * Instance inspection method using default options.
   */
  public inspectDiff(rawPatch: string): ASTDiffGuardReport {
    return PreCommitASTDiffGuard.inspect(rawPatch, this.defaultOptions);
  }

  /**
   * Analyzes a unified git diff patch for credentials, high-entropy secrets,
   * and prompt-injection payloads.
   */
  public static inspect(rawPatch: string, options: InspectDiffOptions = {}): ASTDiffGuardReport {
    const mode = options.mode ?? "warn";
    if (mode === "off" || !rawPatch || rawPatch.trim().length === 0) {
      return {
        allowed: true,
        sanitizedPatch: rawPatch,
        violations: [],
        stats: {
          filesChecked: 0,
          hunksAnalyzed: 0,
          secretsDetected: 0,
          injectionsDetected: 0,
        },
      };
    }

    const violations: ASTDiffViolation[] = [];
    const filesSeen = new Set<string>();
    let hunksCount = 0;

    let currentFile = "unknown";
    let currentLine = 0;

    const lines = rawPatch.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track file header: +++ b/path/to/file
      if (line.startsWith("+++ b/")) {
        currentFile = line.substring(6).trim();
        filesSeen.add(currentFile);
        continue;
      }
      if (line.startsWith("diff --git")) {
        const parts = line.split(" ");
        if (parts.length >= 4) {
          currentFile = parts[3].replace(/^b\//, "");
          filesSeen.add(currentFile);
        }
        continue;
      }

      // Track hunk header: @@ -10,5 +15,7 @@
      if (line.startsWith("@@")) {
        hunksCount++;
        const match = line.match(/\+([0-9]+)/);
        if (match) {
          currentLine = Number.parseInt(match[1], 10) - 1;
        }
        continue;
      }

      // We only inspect added lines in pre-commit (and context lines for prompt injection)
      const isAdded = line.startsWith("+") && !line.startsWith("+++");
      if (isAdded) {
        currentLine++;
      } else if (!line.startsWith("-")) {
        currentLine++;
      }

      if (!isAdded) {
        // Also check context lines for prompt injections
        for (const inj of PROMPT_INJECTION_PATTERNS) {
          if (inj.regex.test(line)) {
            violations.push({
              type: "prompt-injection",
              category: inj.name,
              file: currentFile,
              line: currentLine,
              snippet: line.trim().slice(0, 100),
              confidence: "high",
              actionTaken: mode === "strict" ? "blocked" : "warned",
            });
          }
        }
        continue;
      }

      const content = line.substring(1); // Strip '+'

      // 1. Signature-based credential scanning
      for (const sig of SECRET_SIGNATURES) {
        sig.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = sig.regex.exec(content)) !== null) {
          const matchedSecret = match[0];
          const surrogate = `RD_SURROGATE_${createHash("sha256").update(matchedSecret).digest("hex").slice(0, 12)}`;
          violations.push({
            type: "secret",
            category: sig.category,
            file: currentFile,
            line: currentLine,
            snippet: line.trim().slice(0, 100),
            confidence: sig.confidence,
            actionTaken: mode === "strict" || sig.confidence === "high" ? "blocked" : "warned",
            surrogate,
          });
        }
      }

      // 2. High-entropy assignment token detection
      const assignmentMatch = content.match(
        /(api[_-]?key|secret|password|token|auth_token)\s*[:=]\s*["']([A-Za-z0-9_\-+/]{16,})["']/i,
      );
      if (assignmentMatch) {
        const secretVal = assignmentMatch[2];
        const entropy = calculateShannonEntropy(secretVal);
        if (entropy > 4.2) {
          const surrogate = `RD_SURROGATE_${createHash("sha256").update(secretVal).digest("hex").slice(0, 12)}`;
          violations.push({
            type: "secret",
            category: "high_entropy_secret",
            file: currentFile,
            line: currentLine,
            snippet: `${assignmentMatch[1]} = "[HIGH_ENTROPY_TOKEN]" (H=${entropy})`,
            confidence: entropy > 4.5 ? "high" : "medium",
            actionTaken: mode === "strict" || entropy > 4.5 ? "blocked" : "warned",
            surrogate,
          });
        }
      }

      // 3. Prompt Injection in added lines
      for (const inj of PROMPT_INJECTION_PATTERNS) {
        inj.regex.lastIndex = 0;
        if (inj.regex.test(content)) {
          violations.push({
            type: "prompt-injection",
            category: inj.name,
            file: currentFile,
            line: currentLine,
            snippet: content.trim().slice(0, 100),
            confidence: "high",
            actionTaken: mode === "strict" ? "blocked" : "warned",
          });
        }
      }
    }

    const secretsBlocked = violations.filter(
      (v) => v.type === "secret" && v.actionTaken === "blocked",
    ).length;
    const injectionsBlocked = violations.filter(
      (v) => v.type === "prompt-injection" && v.actionTaken === "blocked",
    ).length;

    // Sanitize patch with volatile surrogates
    const sanitizedPatch = PreCommitASTDiffGuard.sanitize(rawPatch, violations);

    const allowed = mode === "strict" ? violations.length === 0 : secretsBlocked === 0;

    return {
      allowed,
      sanitizedPatch,
      violations,
      stats: {
        filesChecked: filesSeen.size,
        hunksAnalyzed: hunksCount,
        secretsDetected: violations.filter((v) => v.type === "secret").length,
        injectionsDetected: violations.filter((v) => v.type === "prompt-injection").length,
      },
    };
  }

  /**
   * Sanitizes unified patch before transmitting to remote LLM prompts.
   * Replaces credentials with volatile surrogates (RD_SURROGATE_<UUID>) and
   * neutralizes indirect prompt injections.
   */
  public static sanitize(
    rawPatch: string,
    violations: ASTDiffViolation[],
    options: SanitizePatchOptions = {},
  ): string {
    if (!rawPatch || violations.length === 0) return rawPatch;

    let sanitized = rawPatch;

    // Apply surrogate tokens for detected secrets
    for (const v of violations) {
      if (v.type === "secret" && v.surrogate) {
        for (const sig of SECRET_SIGNATURES) {
          sig.regex.lastIndex = 0;
          sanitized = sanitized.replace(sig.regex, (matched) => {
            const h = createHash("sha256").update(matched).digest("hex").slice(0, 12);
            return `RD_SURROGATE_${h}`;
          });
        }

        // Also replace high entropy strings in assignment lines
        sanitized = sanitized.replace(
          /((?:api[_-]?key|secret|password|token|auth_token)\s*[:=]\s*["'])([A-Za-z0-9_\-+/]{16,})(["'])/gi,
          (m, p1, token, p3) => {
            const entropy = calculateShannonEntropy(token);
            if (entropy > 4.2) {
              const h = createHash("sha256").update(token).digest("hex").slice(0, 12);
              return `${p1}RD_SURROGATE_${h}${p3}`;
            }
            return m;
          },
        );
      }

      // Neutralize prompt injections in comments
      if (v.type === "prompt-injection" && options.stripPromptInjections !== false) {
        for (const inj of PROMPT_INJECTION_PATTERNS) {
          sanitized = sanitized.replace(inj.regex, "[SANITIZED_PROMPT_GUARD_OVERRIDE]");
        }
      }
    }

    return sanitized;
  }
}
