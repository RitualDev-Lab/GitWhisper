import type { SecretDetector, SecretFinding, SensitiveScanInput } from "../types.js";
import { computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

const JWT_REGEX = /\b(eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+)\b/g;

export class JwtDetector implements SecretDetector {
  public readonly name = "jwt";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        JWT_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = JWT_REGEX.exec(line.content)) !== null) {
          const jwtToken = match[1] ?? match[0];
          const startCol = match.index;

          findings.push({
            id: `jwt-${line.filePath}-${line.lineNumber}-${startCol}-${line.lineType}`,
            category: "jwt",
            detector: this.name,
            confidence: "high",
            filePath: line.filePath,
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            matchedText: jwtToken,
            maskedPreview: maskSecret(jwtToken, "jwt"),
            startColumn: startCol,
            endColumn: startCol + jwtToken.length,
            placeholder: "<GITWHISPER_REDACTED_JWT>",
            fingerprint: computeFingerprint(jwtToken),
            description: "JSON Web Token (JWT)",
          });
        }
      }
    }

    return findings;
  }

  private scanText(text: string, filePath: string, findings: SecretFinding[]): void {
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      JWT_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = JWT_REGEX.exec(line)) !== null) {
        const jwtToken = match[1] ?? match[0];
        const startCol = match.index;

        findings.push({
          id: `jwt-${filePath}-${idx + 1}-${startCol}-text`,
          category: "jwt",
          detector: this.name,
          confidence: "high",
          filePath,
          lineNumber: idx + 1,
          lineType: "message",
          matchedText: jwtToken,
          maskedPreview: maskSecret(jwtToken, "jwt"),
          startColumn: startCol,
          endColumn: startCol + jwtToken.length,
          placeholder: "<GITWHISPER_REDACTED_JWT>",
          fingerprint: computeFingerprint(jwtToken),
          description: "JSON Web Token (JWT)",
        });
      }
    });
  }
}
