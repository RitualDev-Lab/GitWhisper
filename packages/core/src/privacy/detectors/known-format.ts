import type {
  SecretCategory,
  SecretDetector,
  SecretFinding,
  SensitiveScanInput,
} from "../types.js";
import { computeFingerprint, maskSecret, parseDiffLines } from "../utils.js";

interface KnownFormatRule {
  name: string;
  category: SecretCategory;
  placeholder: string;
  regex: RegExp;
  description: string;
}

const KNOWN_RULES: KnownFormatRule[] = [
  {
    name: "aws-access-key-id",
    category: "cloud-credential",
    placeholder: "<GITWHISPER_REDACTED_AWS_KEY>",
    regex: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g,
    description: "AWS Access Key ID",
  },
  {
    name: "aws-secret-access-key",
    category: "cloud-credential",
    placeholder: "<GITWHISPER_REDACTED_AWS_SECRET>",
    regex: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    description: "AWS Secret Access Key",
  },
  {
    name: "github-token",
    category: "access-token",
    placeholder: "<GITWHISPER_REDACTED_GITHUB_TOKEN>",
    regex:
      /\b(ghp_[0-9a-zA-Z]{36}|gho_[0-9a-zA-Z]{36}|ghu_[0-9a-zA-Z]{36}|ghs_[0-9a-zA-Z]{36}|ghr_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})\b/g,
    description: "GitHub Personal Access Token",
  },
  {
    name: "stripe-api-key",
    category: "api-key",
    placeholder: "<GITWHISPER_REDACTED_STRIPE_KEY>",
    regex: /\b((?:sk|rk|pk)_live_[0-9a-zA-Z]{24,})\b/g,
    description: "Stripe Live API Key",
  },
  {
    name: "slack-token",
    category: "access-token",
    placeholder: "<GITWHISPER_REDACTED_SLACK_TOKEN>",
    regex: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)\b/g,
    description: "Slack API Token",
  },
  {
    name: "openai-api-key",
    category: "api-key",
    placeholder: "<GITWHISPER_REDACTED_API_KEY>",
    regex: /\b(sk-[a-zA-Z0-9]{32,}|sk-proj-[a-zA-Z0-9_-]{40,})\b/g,
    description: "OpenAI API Key",
  },
  {
    name: "google-api-key",
    category: "api-key",
    placeholder: "<GITWHISPER_REDACTED_API_KEY>",
    regex: /\b(AIza[0-9A-Za-z-_]{35})\b/g,
    description: "Google API Key",
  },
];

export class KnownFormatDetector implements SecretDetector {
  public readonly name = "known-format";

  public scan(input: SensitiveScanInput): SecretFinding[] {
    const findings: SecretFinding[] = [];

    if (input.text) {
      this.scanText(input.text, input.filePath ?? "text", findings);
    }

    if (input.patch) {
      const parsedLines = parseDiffLines(input.patch, input.filePath ?? "diff");
      for (const line of parsedLines) {
        for (const rule of KNOWN_RULES) {
          rule.regex.lastIndex = 0;
          let match: RegExpExecArray | null = null;
          while ((match = rule.regex.exec(line.content)) !== null) {
            // If match has capture group, use group 1, else match[0]
            const matchedSecret = match[1] ?? match[0];
            const startCol = match.index + match[0].indexOf(matchedSecret);

            findings.push({
              id: `${rule.name}-${line.filePath}-${line.lineNumber}-${startCol}-${line.lineType}`,
              category: rule.category,
              detector: this.name,
              confidence: "high",
              filePath: line.filePath,
              lineNumber: line.lineNumber,
              lineType: line.lineType,
              matchedText: matchedSecret,
              maskedPreview: maskSecret(matchedSecret, rule.category),
              startColumn: startCol,
              endColumn: startCol + matchedSecret.length,
              placeholder: rule.placeholder,
              fingerprint: computeFingerprint(matchedSecret),
              description: rule.description,
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
      for (const rule of KNOWN_RULES) {
        rule.regex.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = rule.regex.exec(line)) !== null) {
          const matchedSecret = match[1] ?? match[0];
          const startCol = match.index + match[0].indexOf(matchedSecret);

          findings.push({
            id: `${rule.name}-${filePath}-${idx + 1}-${startCol}-text`,
            category: rule.category,
            detector: this.name,
            confidence: "high",
            filePath,
            lineNumber: idx + 1,
            lineType: "message",
            matchedText: matchedSecret,
            maskedPreview: maskSecret(matchedSecret, rule.category),
            startColumn: startCol,
            endColumn: startCol + matchedSecret.length,
            placeholder: rule.placeholder,
            fingerprint: computeFingerprint(matchedSecret),
            description: rule.description,
          });
        }
      }
    });
  }
}
