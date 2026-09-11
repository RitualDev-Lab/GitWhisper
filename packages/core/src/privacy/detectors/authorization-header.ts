import type { SecretDetector, SecretFinding, SensitiveScanInput } from "../types.js";
import { computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

const AUTH_HEADER_REGEX =
  /(?:["']?(?:Authorization|Proxy-Authorization)["']?\s*[:=]\s*["']?)(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/-]+=*)["']?/i;

export class AuthorizationHeaderDetector implements SecretDetector {
  public readonly name = "authorization-header";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        const match = line.content.match(AUTH_HEADER_REGEX);
        if (match?.[2] && match.index !== undefined) {
          const scheme = match[1];
          const token = match[2];
          const tokenStart = line.content.indexOf(token, match.index);

          findings.push({
            id: `auth-header-${line.filePath}-${line.lineNumber}-${line.lineType}`,
            category: "authorization-header",
            detector: this.name,
            confidence: "high",
            filePath: line.filePath,
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            matchedText: token,
            maskedPreview: maskSecret(token),
            startColumn: tokenStart,
            endColumn: tokenStart + token.length,
            placeholder: "<GITWHISPER_REDACTED_AUTH_TOKEN>",
            fingerprint: computeFingerprint(token),
            description: `HTTP ${scheme} authorization credential`,
          });
        }
      }
    }

    return findings;
  }

  private scanText(text: string, filePath: string, findings: SecretFinding[]): void {
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      const match = line.match(AUTH_HEADER_REGEX);
      if (match?.[2] && match.index !== undefined) {
        const scheme = match[1];
        const token = match[2];
        const tokenStart = line.indexOf(token, match.index);

        findings.push({
          id: `auth-header-${filePath}-${idx + 1}-text`,
          category: "authorization-header",
          detector: this.name,
          confidence: "high",
          filePath,
          lineNumber: idx + 1,
          lineType: "message",
          matchedText: token,
          maskedPreview: maskSecret(token),
          startColumn: tokenStart,
          endColumn: tokenStart + token.length,
          placeholder: "<GITWHISPER_REDACTED_AUTH_TOKEN>",
          fingerprint: computeFingerprint(token),
          description: `HTTP ${scheme} authorization credential`,
        });
      }
    });
  }
}
