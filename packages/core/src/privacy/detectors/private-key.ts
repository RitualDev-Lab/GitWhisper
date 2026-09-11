import type { SecretDetector, SecretFinding, SensitiveScanInput } from "../types.js";
import { computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

const PEM_HEADER_REGEX = /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY(?: BLOCK)?-----/;
const PEM_FOOTER_REGEX = /-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY(?: BLOCK)?-----/;

export class PrivateKeyDetector implements SecretDetector {
  public readonly name = "private-key";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    // 1. Text or commit message scan
    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    // 2. Patch scan (both added and deleted lines)
    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        if (PEM_HEADER_REGEX.test(line.content)) {
          const match = line.content.match(PEM_HEADER_REGEX);
          if (match && match.index !== undefined) {
            const matchedText = match[0];
            findings.push({
              id: `privkey-${line.filePath}-${line.lineNumber}-${line.lineType}`,
              category: "private-key",
              detector: this.name,
              confidence: "high",
              filePath: line.filePath,
              lineNumber: line.lineNumber,
              lineType: line.lineType,
              matchedText,
              maskedPreview: maskSecret(matchedText, "private-key"),
              startColumn: match.index,
              endColumn: match.index + matchedText.length,
              placeholder: "<GITWHISPER_REDACTED_PRIVATE_KEY>",
              fingerprint: computeFingerprint(matchedText),
              description: "Private cryptographic key (PEM block header)",
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
      const match = line.match(PEM_HEADER_REGEX);
      if (match && match.index !== undefined) {
        const matchedText = match[0];
        findings.push({
          id: `privkey-${filePath}-${idx + 1}-text`,
          category: "private-key",
          detector: this.name,
          confidence: "high",
          filePath,
          lineNumber: idx + 1,
          lineType: "message",
          matchedText,
          maskedPreview: maskSecret(matchedText, "private-key"),
          startColumn: match.index,
          endColumn: match.index + matchedText.length,
          placeholder: "<GITWHISPER_REDACTED_PRIVATE_KEY>",
          fingerprint: computeFingerprint(matchedText),
          description: "Private cryptographic key (PEM block header)",
        });
      }
    });
  }
}
