import readline from "node:readline/promises";
import type { ChangeContext, CommitProposal, DecisionProvenance } from "@gitwhisper/core";
import { colors } from "./terminal.js";

/**
 * Renders an evidence and signal details view for the proposed commit classification,
 * including structured decision provenance.
 */
export async function showCommitDetails(
  context: ChangeContext,
  proposal: CommitProposal,
  provenance?: DecisionProvenance[],
): Promise<void> {
  console.log(`\n ${colors.bold}${colors.cyan}Commit Intelligence Analysis${colors.reset}\n`);

  // Decision Provenance Section
  if (provenance && provenance.length > 0) {
    console.log(` ${colors.bold}Decision Provenance${colors.reset}`);
    for (const p of provenance) {
      const sourceColor =
        p.source === "user"
          ? colors.cyan
          : p.source === "git"
            ? colors.green
            : p.source === "history"
              ? colors.yellow
              : p.source === "config"
                ? colors.magenta
                : colors.dim;

      console.log(
        `  ${colors.bold}${p.field.padEnd(8)}${colors.reset} ${p.decision} (${sourceColor}source: ${p.source}${colors.reset})`,
      );
      for (const ev of p.evidence) {
        console.log(`   ${colors.dim}• ${ev}${colors.reset}`);
      }
    }
    console.log("");
  }

  // 1. Type Details
  console.log(` ${colors.bold}Type Decision${colors.reset}`);
  console.log(
    `  Selected:   ${colors.green}${proposal.type}${colors.reset} (${proposal.confidence.type} confidence)`,
  );

  if (proposal.evidence.typeReasons.length > 0) {
    console.log("  Evidence:");
    for (const reason of proposal.evidence.typeReasons) {
      console.log(`   • ${reason}`);
    }
  }

  const alternativeTypes = context.intelligence.probableTypes.filter(
    (t) => t.type.toLowerCase() !== proposal.type.toLowerCase(),
  );
  if (alternativeTypes.length > 0) {
    console.log("  Alternatives:");
    for (const alt of alternativeTypes.slice(0, 3)) {
      console.log(
        `   - ${colors.dim}${alt.type.padEnd(10)}${colors.reset} score: ${alt.score} (${alt.confidence})`,
      );
    }
  }

  // 2. Scope Details
  console.log(`\n ${colors.bold}Scope Decision${colors.reset}`);
  console.log(
    `  Selected:   ${colors.green}${proposal.scope || "none"}${colors.reset} (${proposal.confidence.scope} confidence)`,
  );

  if (proposal.evidence.scopeReasons.length > 0) {
    console.log("  Evidence:");
    for (const reason of proposal.evidence.scopeReasons) {
      console.log(`   • ${reason}`);
    }
  }

  const alternativeScopes = context.intelligence.probableScopes.filter(
    (s) => s.scope.toLowerCase() !== (proposal.scope || "none").toLowerCase(),
  );
  if (alternativeScopes.length > 0) {
    console.log("  Alternative scopes:");
    for (const alt of alternativeScopes.slice(0, 3)) {
      console.log(
        `   - ${colors.dim}${alt.scope.padEnd(12)}${colors.reset} score: ${alt.score} (${alt.confidence})`,
      );
    }
  }

  // 3. Signals
  if (context.intelligence.signals.length > 0) {
    console.log(`\n ${colors.bold}Detected Signals${colors.reset}`);
    for (const sig of context.intelligence.signals) {
      console.log(`  [${sig.source}] ${sig.evidence}`);
    }
  }

  // 4. File categories
  const cat = context.intelligence.fileCategories;
  console.log(`\n ${colors.bold}Staged Breakdown${colors.reset}`);
  console.log(
    `  ${cat.source} source, ${cat.test} test, ${cat.documentation} doc, ${cat.configuration} config, ${cat.dependency} dep`,
  );

  console.log(`\n ${colors.dim}Press Enter to return to menu...${colors.reset}`);

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("");
    rl.close();
  }
}
