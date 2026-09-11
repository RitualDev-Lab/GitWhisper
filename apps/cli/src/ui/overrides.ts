import readline from "node:readline/promises";
import { colors } from "./terminal.js";

/**
 * Interactive selector for overriding the Conventional Commit type.
 */
export async function pickCommitType(allowedTypes: string[], currentType: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n ${colors.bold}Choose commit type:${colors.reset}\n`);

  allowedTypes.forEach((t, i) => {
    const isCurrent =
      t.toLowerCase() === currentType.toLowerCase()
        ? ` ${colors.green}(current)${colors.reset}`
        : "";
    console.log(`  ${(i + 1).toString().padStart(2)}. ${t}${isCurrent}`);
  });

  try {
    const answer = await rl.question(`\n Select [${currentType}]: `);
    const trimmed = answer.trim();
    const num = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(num) && num > 0 && num <= allowedTypes.length) {
      return allowedTypes[num - 1];
    }
    if (trimmed && allowedTypes.map((t) => t.toLowerCase()).includes(trimmed.toLowerCase())) {
      return trimmed.toLowerCase();
    }
    return currentType;
  } finally {
    rl.close();
  }
}

/**
 * Interactive selector for overriding the commit scope.
 */
export async function pickCommitScope(
  suggestedScopes: string[],
  currentScope?: string,
): Promise<string | undefined> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n ${colors.bold}Choose commit scope:${colors.reset}\n`);

  const unique = Array.from(new Set([...suggestedScopes, "none"])).filter((s) => s.length > 0);

  unique.forEach((s, i) => {
    const isCurrent =
      (s === "none" && !currentScope) ||
      (currentScope && s.toLowerCase() === currentScope.toLowerCase())
        ? ` ${colors.green}(current)${colors.reset}`
        : "";
    console.log(`  ${(i + 1).toString().padStart(2)}. ${s}${isCurrent}`);
  });
  console.log("  custom. Type custom scope name");

  try {
    const defaultVal = currentScope || "none";
    const answer = await rl.question(`\n Select [${defaultVal}]: `);
    const trimmed = answer.trim().toLowerCase();

    const num = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(num) && num > 0 && num <= unique.length) {
      const selected = unique[num - 1];
      return selected === "none" ? undefined : selected;
    }

    if (trimmed === "none" || trimmed === "") {
      return currentScope;
    }

    // Custom scope typed directly
    return trimmed.replace(/[()]/g, "");
  } finally {
    rl.close();
  }
}

/**
 * Interactive prompt for toggling breaking changes.
 */
export async function toggleBreakingChange(currentBreaking: boolean): Promise<{
  breaking: boolean;
  breakingDescription?: string;
}> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\n ${colors.bold}Breaking Change Setting${colors.reset}`);
  console.log(
    ` Current status: ${currentBreaking ? `${colors.red}YES` : `${colors.green}NO`}${colors.reset}\n`,
  );

  try {
    const toggleAnswer = await rl.question(" Toggle breaking change? (y/N): ");
    const willBeBreaking =
      toggleAnswer.trim().toLowerCase() === "y" || toggleAnswer.trim().toLowerCase() === "yes"
        ? !currentBreaking
        : currentBreaking;

    let breakingDescription: string | undefined;
    if (willBeBreaking) {
      const descAnswer = await rl.question(" Breaking change description (optional): ");
      if (descAnswer.trim()) {
        breakingDescription = descAnswer.trim();
      }
    }

    return {
      breaking: willBeBreaking,
      breakingDescription,
    };
  } finally {
    rl.close();
  }
}
