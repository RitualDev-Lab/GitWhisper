import type { SecretDetector, SecretFinding, SensitiveScanInput } from "../types.js";
import { calculateEntropy, computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

export { calculateEntropy as calculateShannonEntropy };

/**
 * Pre-commit Shannon Entropy Secret Blocking Detector
 * Detects high-entropy random secrets and cryptographic tokens (H > 4.5 bits/char)
 * often assigned in source code, configuration files, or commit diffs.
 */
export class ShannonEntropyDetector implements SecretDetector {
  public readonly name = "shannon-entropy";
  private entropyThreshold: number;

  constructor(entropyThreshold = 4.5) {
    this.entropyThreshold = entropyThreshold;
  }

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const targetText = input.text || input.patch;
    if (!targetText) return findings;

    const lines = parseDiffLines(targetText, input.filePath);

    // Look for variable assignments or quoted tokens
    const assignmentRegex =
      /(?:key|token|secret|password|auth|credential|api[_-]?key)\s*[:=]\s*["']([^"'\s]{16,120})["']/gi;
    const genericTokenRegex = /["']([a-zA-Z0-9_\-+/=]{20,120})["']/g;

    for (const parsedLine of lines) {
      // Only inspect added lines or commit messages (ignore deletions)
      if (parsedLine.lineType === "deleted" || parsedLine.lineType === "context") continue;

      const content = parsedLine.content;

      // 1. Direct variable assignments with secret-like names
      assignmentRegex.lastIndex = 0;
      let match = assignmentRegex.exec(content);
      while (match !== null) {
        const candidate = match[1];
        if (this.isValidSecretCandidate(candidate)) {
          const entropy = calculateEntropy(candidate);
          if (entropy >= this.entropyThreshold) {
            findings.push(
              this.createFinding(
                candidate,
                parsedLine.filePath || input.filePath || "unknown",
                parsedLine.lineNumber,
                parsedLine.lineType,
                entropy,
                match.index,
              ),
            );
          }
        }
        match = assignmentRegex.exec(content);
      }

      // 2. High-entropy standalone quoted tokens
      genericTokenRegex.lastIndex = 0;
      let tokenMatch = genericTokenRegex.exec(content);
      while (tokenMatch !== null) {
        const candidate = tokenMatch[1];
        const alreadyFlagged = findings.some(
          (f) => f.matchedText === candidate && f.lineNumber === parsedLine.lineNumber,
        );
        if (!alreadyFlagged && this.isValidSecretCandidate(candidate)) {
          const entropy = calculateEntropy(candidate);
          if (entropy >= this.entropyThreshold) {
            findings.push(
              this.createFinding(
                candidate,
                parsedLine.filePath || input.filePath || "unknown",
                parsedLine.lineNumber,
                parsedLine.lineType,
                entropy,
                tokenMatch.index,
              ),
            );
          }
        }
        tokenMatch = genericTokenRegex.exec(content);
      }
    }

    return findings;
  }

  private isValidSecretCandidate(token: string): boolean {
    if (token.length < 16) return false;
    if (UUID_REGEX.test(token)) return false;
    if (COMMIT_SHA_REGEX.test(token)) return false;
    if (token.startsWith("http://") || token.startsWith("https://")) return false;
    if (token.includes(" ")) return false;
    return true;
  }

  private createFinding(
    matchedText: string,
    filePath: string,
    lineNumber: number,
    lineType: "added" | "deleted" | "context" | "message",
    entropy: number,
    startCol: number,
  ): SecretFinding {
    const fingerprint = computeFingerprint(matchedText);
    const placeholder = "<GITWHISPER_REDACTED_HIGH_ENTROPY_SECRET>";
    return {
      id: `entropy-${fingerprint.slice(0, 8)}`,
      category: "api-key",
      detector: this.name,
      confidence: "high",
      filePath,
      lineNumber,
      lineType,
      matchedText,
      maskedPreview: maskSecret(matchedText),
      startColumn: startCol,
      endColumn: startCol + matchedText.length,
      placeholder,
      fingerprint,
      description: `High-Entropy Secret Token (Shannon Entropy H=${entropy.toFixed(2)} > ${this.entropyThreshold})`,
    };
  }
}
