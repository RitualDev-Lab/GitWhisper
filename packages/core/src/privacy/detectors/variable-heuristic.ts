import type {
  SecretCategory,
  SecretDetector,
  SecretFinding,
  SensitiveScanInput,
} from "../types.js";
import {
  calculateEntropy,
  computeFingerprint,
  isPlaceholder,
  maskSecret,
  parseDiffLines,
} from "../utils.js";

const VAR_ASSIGNMENT_REGEX =
  /(?:const|let|var|val|final|String|private|public|protected)?\s*(?:[a-zA-Z0-9_]*?(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|client[_-]?secret|password|passwd|private[_-]?key)[a-zA-Z0-9_]*)\s*[:=]\s*["'`]([^"'`\s\r\n]{8,})["'`]/gi;

export class VariableHeuristicDetector implements SecretDetector {
  public readonly name = "variable-heuristic";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        VAR_ASSIGNMENT_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = VAR_ASSIGNMENT_REGEX.exec(line.content)) !== null) {
          const value = match[1];
          if (!value || isPlaceholder(value)) continue;

          const entropy = calculateEntropy(value);
          const confidence = entropy >= 3.2 && value.length >= 16 ? "medium" : "low";

          const category: SecretCategory = /password|passwd/i.test(match[0])
            ? "password"
            : "api-key";

          const valStart = line.content.indexOf(value, match.index);

          findings.push({
            id: `var-heuristic-${line.filePath}-${line.lineNumber}-${valStart}-${line.lineType}`,
            category,
            detector: this.name,
            confidence,
            filePath: line.filePath,
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            matchedText: value,
            maskedPreview: maskSecret(value, category),
            startColumn: valStart,
            endColumn: valStart + value.length,
            placeholder: "<GITWHISPER_REDACTED_SECRET>",
            fingerprint: computeFingerprint(value),
            description: `Heuristic variable credential assignment (${category})`,
          });
        }
      }
    }

    return findings;
  }

  private scanText(text: string, filePath: string, findings: SecretFinding[]): void {
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      VAR_ASSIGNMENT_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = VAR_ASSIGNMENT_REGEX.exec(line)) !== null) {
        const value = match[1];
        if (!value || isPlaceholder(value)) continue;

        const entropy = calculateEntropy(value);
        const confidence = entropy >= 3.2 && value.length >= 16 ? "medium" : "low";

        const category: SecretCategory = /password|passwd/i.test(match[0]) ? "password" : "api-key";

        const valStart = line.indexOf(value, match.index);

        findings.push({
          id: `var-heuristic-${filePath}-${idx + 1}-${valStart}-text`,
          category,
          detector: this.name,
          confidence,
          filePath,
          lineNumber: idx + 1,
          lineType: "message",
          matchedText: value,
          maskedPreview: maskSecret(value, category),
          startColumn: valStart,
          endColumn: valStart + value.length,
          placeholder: "<GITWHISPER_REDACTED_SECRET>",
          fingerprint: computeFingerprint(value),
          description: `Heuristic variable credential assignment (${category})`,
        });
      }
    });
  }
}
