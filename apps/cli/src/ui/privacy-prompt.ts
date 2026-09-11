import readline from "node:readline";
import type { AIProvider } from "@gitwhisper/ai";
import type { ChangeContext, SecretFinding } from "@gitwhisper/core";
import { redactPatch } from "@gitwhisper/core";
import { colors } from "./terminal.js";

export type PrivacyPromptChoice = "redact" | "cancel";

export async function promptPrivacyReview(
  findings: SecretFinding[],
  provider: AIProvider,
  context: ChangeContext,
): Promise<PrivacyPromptChoice> {
  const highCount = findings.filter((f) => f.confidence === "high").length;
  const medCount = findings.filter((f) => f.confidence === "medium").length;
  const lowCount = findings.filter((f) => f.confidence === "low").length;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  const renderSummary = () => {
    console.log(
      `\n ${colors.yellow}⚠️  GitWhisper Privacy Boundary: Sensitive content detected in staged changes!${colors.reset}`,
    );
    console.log(
      `    Provider: ${provider.isLocal ? `${colors.green}local` : `${colors.yellow}remote`} (${provider.baseUrl})${colors.reset}`,
    );
    console.log(
      `    Findings: ${findings.length} secret(s) (${colors.red}${highCount} high${colors.reset}, ${colors.yellow}${medCount} med${colors.reset}, ${colors.cyan}${lowCount} low${colors.reset})\n`,
    );

    for (const f of findings.slice(0, 5)) {
      const badge =
        f.confidence === "high"
          ? `${colors.red}[HIGH]${colors.reset}`
          : `${colors.yellow}[MED]${colors.reset}`;
      console.log(
        `    • ${badge} ${f.filePath}:${f.lineNumber} (${f.lineType}) — ${f.description}: ${colors.dim}${f.maskedPreview}${colors.reset}`,
      );
    }

    if (findings.length > 5) {
      console.log(`    ... and ${findings.length - 5} more findings`);
    }

    console.log(`
    ${colors.bold}[r]${colors.reset} Redact & continue (safe remote transmission)
    ${colors.bold}[p]${colors.reset} Preview sanitized diff
    ${colors.bold}[d]${colors.reset} View detection details
    ${colors.bold}[q]${colors.reset} Cancel commit
`);
  };

  try {
    renderSummary();

    while (true) {
      const answer = (await question(" Select action [r/p/d/q] (default: r): "))
        .trim()
        .toLowerCase();

      if (answer === "" || answer === "r" || answer === "redact") {
        rl.close();
        return "redact";
      }

      if (answer === "q" || answer === "cancel" || answer === "exit") {
        rl.close();
        return "cancel";
      }

      if (answer === "p" || answer === "preview") {
        const { sanitizedPatch } = redactPatch(context.patch, findings);
        console.log(`\n--- ${colors.bold}Sanitized Diff Preview${colors.reset} ---`);
        const previewLines = sanitizedPatch.split("\n").slice(0, 30);
        console.log(previewLines.join("\n"));
        if (sanitizedPatch.split("\n").length > 30) {
          console.log(
            `${colors.dim}... (${sanitizedPatch.split("\n").length - 30} lines truncated)${colors.reset}`,
          );
        }
        console.log("--------------------------------\n");
        continue;
      }

      if (answer === "d" || answer === "details") {
        console.log(`\n--- ${colors.bold}Detection Details${colors.reset} ---`);
        let idx = 1;
        for (const f of findings) {
          console.log(` [${idx}] ${f.filePath}:${f.lineNumber} (${f.lineType})`);
          console.log(`     Detector:   ${f.detector}`);
          console.log(`     Category:   ${f.category}`);
          console.log(`     Confidence: ${f.confidence}`);
          console.log(`     Preview:    ${f.maskedPreview}`);
          console.log(`     Replace:    ${f.placeholder}`);
          idx++;
        }
        console.log("--------------------------------\n");
        continue;
      }

      console.log(" Invalid choice. Please enter 'r', 'p', 'd', or 'q'.");
    }
  } finally {
    rl.close();
  }
}
