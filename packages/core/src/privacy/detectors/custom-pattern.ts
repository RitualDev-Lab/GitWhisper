import type {
  CustomSecretPattern,
  SecretCategory,
  SecretConfidence,
  SecretDetector,
  SecretFinding,
  SensitiveScanInput,
} from "../types.js";
import { computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

interface CompiledCustomPattern {
  name: string;
  category: SecretCategory;
  confidence: SecretConfidence;
  regex: RegExp;
  placeholder: string;
}

export class CustomPatternDetector implements SecretDetector {
  public readonly name = "custom-pattern";
  private compiledPatterns: CompiledCustomPattern[] = [];

  constructor(patterns: CustomSecretPattern[] = []) {
    this.compilePatterns(patterns);
  }

  private compilePatterns(patterns: CustomSecretPattern[]): void {
    this.compiledPatterns = [];
    for (const p of patterns) {
      if (!p.pattern || p.pattern.length > 500) continue; // Basic ReDoS / length guard
      try {
        const regex = new RegExp(p.pattern, "g");
        this.compiledPatterns.push({
          name: p.name || "custom-rule",
          category: (p.category as SecretCategory) || "generic-secret",
          confidence: p.confidence || "high",
          regex,
          placeholder: "<GITWHISPER_REDACTED_CUSTOM>",
        });
      } catch {
        // Ignore invalid regexes gracefully
      }
    }
  }

  public scan(input: SensitiveScanInput): SecretFinding[] {
    if (this.compiledPatterns.length === 0) return [];
    const findings: SecretFinding[] = [];

    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        for (const pattern of this.compiledPatterns) {
          pattern.regex.lastIndex = 0;
          let match: RegExpExecArray | null = null;
          while ((match = pattern.regex.exec(line.content)) !== null) {
            const matchedSecret = match[1] ?? match[0];
            if (!matchedSecret) break;
            const startCol = match.index;

            findings.push({
              id: `custom-${pattern.name}-${line.filePath}-${line.lineNumber}-${startCol}-${line.lineType}`,
              category: pattern.category,
              detector: this.name,
              confidence: pattern.confidence,
              filePath: line.filePath,
              lineNumber: line.lineNumber,
              lineType: line.lineType,
              matchedText: matchedSecret,
              maskedPreview: maskSecret(matchedSecret, pattern.category),
              startColumn: startCol,
              endColumn: startCol + matchedSecret.length,
              placeholder: pattern.placeholder,
              fingerprint: computeFingerprint(matchedSecret),
              description: `User-defined custom pattern: ${pattern.name}`,
            });
          }
        }
      }
    }

    return findings;
  }

  private scanText(text: string, filePath: string, findings: SecretFinding[]): void {
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      for (const pattern of this.compiledPatterns) {
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = pattern.regex.exec(line)) !== null) {
          const matchedSecret = match[1] ?? match[0];
          if (!matchedSecret) break;
          const startCol = match.index;

          findings.push({
            id: `custom-${pattern.name}-${filePath}-${idx + 1}-${startCol}-text`,
            category: pattern.category,
            detector: this.name,
            confidence: pattern.confidence,
            filePath,
            lineNumber: idx + 1,
            lineType: "message",
            matchedText: matchedSecret,
            maskedPreview: maskSecret(matchedSecret, pattern.category),
            startColumn: startCol,
            endColumn: startCol + matchedSecret.length,
            placeholder: pattern.placeholder,
            fingerprint: computeFingerprint(matchedSecret),
            description: `User-defined custom pattern: ${pattern.name}`,
          });
        }
      }
    });
  }
}
