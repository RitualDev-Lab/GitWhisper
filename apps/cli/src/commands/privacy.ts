import { loadConfig } from "@gitwhisper/config";
import { buildChangeContext, scanSensitiveContent } from "@gitwhisper/core";
import { findRepository, hasStagedChanges } from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface PrivacyCommandOptions {
  json?: boolean;
  staged?: boolean;
  details?: boolean;
}

export async function runPrivacy(
  action = "scan",
  options: PrivacyCommandOptions = {},
): Promise<void> {
  const repoRoot = await findRepository();
  if (!repoRoot) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            error: {
              code: "NOT_A_GIT_REPOSITORY",
              message: "Not inside a Git repository.",
            },
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    process.exit(1);
  }

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            safe: true,
            message: "No staged changes to scan.",
            findingsCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            scannedBytes: 0,
            findings: [],
          },
          null,
          2,
        ),
      );
      return;
    }
    printHeader();
    console.log(` ${colors.green}✓ No staged changes found to scan.${colors.reset}`);
    console.log("   Stage files with `git add <files>` first.\n");
    return;
  }

  const config = await loadConfig({}, repoRoot);
  const context = await buildChangeContext(repoRoot);

  const scanResult = await scanSensitiveContent(
    {
      patch: context.patch,
      files: context.files,
    },
    { config: config.privacy },
  );

  const findings = scanResult.findings;
  const highCount = findings.filter((f) => f.confidence === "high").length;
  const mediumCount = findings.filter((f) => f.confidence === "medium").length;
  const lowCount = findings.filter((f) => f.confidence === "low").length;

  if (options.json) {
    // Strip matchedText to prevent secret leakage in logs/stdout
    const safeFindings = findings.map((f) => ({
      id: f.id,
      category: f.category,
      detector: f.detector,
      confidence: f.confidence,
      filePath: f.filePath,
      lineNumber: f.lineNumber,
      lineType: f.lineType,
      maskedPreview: f.maskedPreview,
      placeholder: f.placeholder,
      description: f.description,
    }));

    console.log(
      JSON.stringify(
        {
          safe: findings.length === 0,
          findingsCount: findings.length,
          highCount,
          mediumCount,
          lowCount,
          scannedBytes: scanResult.scannedBytes,
          findings: safeFindings,
        },
        null,
        2,
      ),
    );

    if (findings.length > 0) {
      process.exit(1);
    }
    return;
  }

  printHeader();

  if (findings.length === 0) {
    console.log(
      ` ${colors.green}✓ Privacy Scan Passed: No secrets detected in staged changes.${colors.reset}`,
    );
    console.log(`   Scanned ${context.files.length} file(s) (${scanResult.scannedBytes} bytes).\n`);
    return;
  }

  console.log(
    ` ${colors.yellow}⚠️  Privacy Scan Warning: ${findings.length} potential secret(s) detected!${colors.reset}\n`,
  );
  console.log(
    `   Breakdown: ${colors.red}${highCount} high${colors.reset}, ${colors.yellow}${mediumCount} medium${colors.reset}, ${colors.cyan}${lowCount} low${colors.reset}\n`,
  );

  for (const finding of findings) {
    const badge =
      finding.confidence === "high"
        ? `${colors.red}[HIGH]${colors.reset}`
        : finding.confidence === "medium"
          ? `${colors.yellow}[MED]${colors.reset}`
          : `${colors.cyan}[LOW]${colors.reset}`;

    console.log(
      `   ${badge} ${colors.bold}${finding.filePath}:${finding.lineNumber}${colors.reset} (${finding.lineType})`,
    );
    console.log(
      `          ${finding.description ?? finding.category}: ${colors.dim}${finding.maskedPreview}${colors.reset}`,
    );
    console.log(`          Placeholder: ${colors.dim}${finding.placeholder}${colors.reset}\n`);
  }

  console.log(" GitWhisper will block or redact these before sending to remote models.");
  console.log(" To unstage a file, run: git restore --staged <file>\n");

  process.exit(1);
}
