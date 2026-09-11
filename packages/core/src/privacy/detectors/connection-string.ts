import type { SecretDetector, SecretFinding, SensitiveScanInput } from "../types.js";
import { computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

const DB_CONN_REGEX =
  /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^:\s]+:([^@\s"']+)@[^\s"']+)\b/gi;

export class ConnectionStringDetector implements SecretDetector {
  public readonly name = "connection-string";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        DB_CONN_REGEX.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = DB_CONN_REGEX.exec(line.content)) !== null) {
          const password = match[2];
          if (!password) continue;

          // Target password for redaction, preserving scheme and host
          const passwordStart = line.content.indexOf(`:${password}@`, match.index) + 1;

          findings.push({
            id: `conn-str-${line.filePath}-${line.lineNumber}-${passwordStart}-${line.lineType}`,
            category: "connection-string",
            detector: this.name,
            confidence: "high",
            filePath: line.filePath,
            lineNumber: line.lineNumber,
            lineType: line.lineType,
            matchedText: password,
            maskedPreview: maskSecret(password, "password"),
            startColumn: passwordStart,
            endColumn: passwordStart + password.length,
            placeholder: "<GITWHISPER_REDACTED_PASSWORD>",
            fingerprint: computeFingerprint(password),
            description: "Database connection string password credential",
          });
        }
      }
    }

    return findings;
  }

  private scanText(text: string, filePath: string, findings: SecretFinding[]): void {
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      DB_CONN_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = DB_CONN_REGEX.exec(line)) !== null) {
        const password = match[2];
        if (!password) continue;

        const passwordStart = line.indexOf(`:${password}@`, match.index) + 1;

        findings.push({
          id: `conn-str-${filePath}-${idx + 1}-${passwordStart}-text`,
          category: "connection-string",
          detector: this.name,
          confidence: "high",
          filePath,
          lineNumber: idx + 1,
          lineType: "message",
          matchedText: password,
          maskedPreview: maskSecret(password, "password"),
          startColumn: passwordStart,
          endColumn: passwordStart + password.length,
          placeholder: "<GITWHISPER_REDACTED_PASSWORD>",
          fingerprint: computeFingerprint(password),
          description: "Database connection string password credential",
        });
      }
    });
  }
}
