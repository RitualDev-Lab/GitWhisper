import type { SecretDetector, SecretFinding, SensitiveScanInput } from "../types.js";
import {
  calculateEntropy,
  computeFingerprint,
  isPlaceholder,
  maskSecret,
  parseDiffLines,
} from "../utils.js";

const SENSITIVE_KEY_REGEX =
  /^[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|PRIVATE)[A-Z0-9_]*\s*=\s*(.+)$/i;
const GENERAL_ENV_ASSIGNMENT = /^([A-Z0-9_]+)\s*=\s*(.+)$/;

export class EnvironmentFileDetector implements SecretDetector {
  public readonly name = "env-file";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        const isEnvFile = /(?:^|[/\\])\.env(?:\.[a-zA-Z0-9._-]+)?$/i.test(line.filePath);
        const trimmedContent = line.content.trim();

        // 1. Check explicit sensitive key match
        const sensitiveMatch = trimmedContent.match(SENSITIVE_KEY_REGEX);
        if (sensitiveMatch?.[2]) {
          const rawValue = sensitiveMatch[2].trim().replace(/^["']|["']$/g, "");
          if (rawValue.length > 0 && !isPlaceholder(rawValue)) {
            const valStart = line.content.indexOf(sensitiveMatch[2]);
            const confidence = isEnvFile || rawValue.length >= 16 ? "high" : "medium";

            findings.push({
              id: `env-${line.filePath}-${line.lineNumber}-${line.lineType}`,
              category: "environment-secret",
              detector: this.name,
              confidence,
              filePath: line.filePath,
              lineNumber: line.lineNumber,
              lineType: line.lineType,
              matchedText: rawValue,
              maskedPreview: maskSecret(rawValue, "environment-secret"),
              startColumn: valStart,
              endColumn: valStart + rawValue.length,
              placeholder: "<GITWHISPER_REDACTED_ENV_SECRET>",
              fingerprint: computeFingerprint(rawValue),
              description: `Environment secret assignment in ${line.filePath}`,
            });
          }
          continue;
        }

        // 2. If it's explicitly a .env file, scan all assignments for high-entropy values
        if (isEnvFile) {
          const generalMatch = trimmedContent.match(GENERAL_ENV_ASSIGNMENT);
          if (generalMatch?.[2]) {
            const rawValue = generalMatch[2].trim().replace(/^["']|["']$/g, "");
            if (rawValue.length >= 10 && !isPlaceholder(rawValue)) {
              const entropy = calculateEntropy(rawValue);
              if (entropy > 2.8) {
                const valStart = line.content.indexOf(generalMatch[2]);
                findings.push({
                  id: `env-${line.filePath}-${line.lineNumber}-${line.lineType}`,
                  category: "environment-secret",
                  detector: this.name,
                  confidence: "medium",
                  filePath: line.filePath,
                  lineNumber: line.lineNumber,
                  lineType: line.lineType,
                  matchedText: rawValue,
                  maskedPreview: maskSecret(rawValue, "environment-secret"),
                  startColumn: valStart,
                  endColumn: valStart + rawValue.length,
                  placeholder: "<GITWHISPER_REDACTED_ENV_SECRET>",
                  fingerprint: computeFingerprint(rawValue),
                  description: `Potentially sensitive environment value in ${line.filePath}`,
                });
              }
            }
          }
        }
      }
    }

    return findings;
  }
}
