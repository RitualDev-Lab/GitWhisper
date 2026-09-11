import {
  type CommitComposerSession,
  type CommitVariantStyle,
  sanitizeTerminalString,
} from "@gitwhisper/core";
import { colors } from "./terminal.js";

export interface RenderComposerOptions {
  showEvidence?: boolean;
  showProvider?: boolean;
  hasSplitSuggestion?: boolean;
  splitCount?: number;
  validationErrors?: string[];
  validationWarnings?: string[];
  statusMessage?: string;
  errorMessage?: string;
  workItemKey?: string;
  workItemTitle?: string;
  workItemRelevance?: string;
}

/**
 * Renders the high-trust interactive GitWhisper commit composer dashboard.
 * Strips all ANSI, OSC escape sequences, and dangerous control characters
 * from external strings to protect the developer terminal.
 */
export function renderComposerDashboard(
  session: CommitComposerSession,
  options: RenderComposerOptions = {},
): void {
  // Clear screen or separator
  console.log(`\n${"═".repeat(64)}`);

  // 1. Header & Provider
  const version = "v0.8.0";
  const privacy = session.provider.isLocal
    ? `${colors.green}[Local]${colors.reset}`
    : `${colors.yellow}[Remote]${colors.reset}`;

  const timing = session.timing.providerMs
    ? `${colors.dim}(${session.timing.providerMs}ms)${colors.reset}`
    : "";

  console.log(
    ` ${colors.bold}GitWhisper${colors.reset} ${colors.dim}${version}${colors.reset}  ${privacy}  ${colors.dim}${sanitizeTerminalString(session.provider.id)} (${sanitizeTerminalString(session.provider.model)})${colors.reset} ${timing}`,
  );

  // 2. Repository & Staged context
  const branch = session.repository.branch
    ? `(${colors.cyan}${sanitizeTerminalString(session.repository.branch)}${colors.reset})`
    : "";
  const repoName = sanitizeTerminalString(session.repository.name);
  const additions = `${colors.green}+${session.changeContext.stats.additions}${colors.reset}`;
  const deletions = `${colors.red}-${session.changeContext.stats.deletions}${colors.reset}`;
  const fileCount = session.repository.stagedCount;

  console.log(
    ` ${colors.dim}Repo:${colors.reset} ${repoName} ${branch}  ${colors.dim}Staged:${colors.reset} ${fileCount} files (${additions}, ${deletions})`,
  );

  if (options.workItemKey) {
    const relColor =
      options.workItemRelevance === "high"
        ? colors.green
        : options.workItemRelevance === "medium"
          ? colors.yellow
          : colors.dim;
    const titleSnippet = options.workItemTitle ? ` · ${options.workItemTitle.slice(0, 40)}` : "";
    console.log(
      ` ${colors.dim}Intent:${colors.reset} ${colors.cyan}${sanitizeTerminalString(options.workItemKey)}${colors.reset}${sanitizeTerminalString(titleSnippet)} ${relColor}[${options.workItemRelevance ?? "detected"}]${colors.reset}`,
    );
  }

  if (options.hasSplitSuggestion) {
    const count = options.splitCount ?? 2;
    console.log(
      ` ${colors.yellow}💡 Multi-concern staged changes detected (${count} concerns). Press [p] for patch & plan.${colors.reset}`,
    );
  }

  console.log("");

  // 2b. Detected Intelligence Summary
  const activeVariant =
    session.variants.find((v) => v.id === session.selectedVariantId) || session.variants[0];

  if (activeVariant) {
    const pad = 14;
    console.log(` ${colors.bold}Detected${colors.reset}\n`);
    console.log(
      ` ${colors.dim}${"Type".padEnd(pad)}${colors.reset} ${colors.green}${sanitizeTerminalString(activeVariant.proposal.type)}${colors.reset}`,
    );
    console.log(
      ` ${colors.dim}${"Scope".padEnd(pad)}${colors.reset} ${activeVariant.proposal.scope ? colors.cyan + sanitizeTerminalString(activeVariant.proposal.scope) : `${colors.dim}none`}${colors.reset}`,
    );
    console.log(
      ` ${colors.dim}${"Confidence".padEnd(pad)}${colors.reset} ${activeVariant.proposal.confidence.type}`,
    );
    if (activeVariant.proposal.breaking) {
      console.log(
        ` ${colors.dim}${"Breaking".padEnd(pad)}${colors.reset} ${colors.red}YES (!)${colors.reset}`,
      );
    }
    console.log("");
  }

  // 3. Variant Switcher Tabs
  const styles: CommitVariantStyle[] = ["concise", "descriptive", "detailed"];

  const tabs = styles.map((style, idx) => {
    const num = idx + 1;
    const label = style.charAt(0).toUpperCase() + style.slice(1);
    const isSelected = activeVariant?.style === style;
    if (isSelected) {
      return `${colors.bold}${colors.cyan}[${num}] ${label} ●${colors.reset}`;
    }
    return `${colors.dim}[${num}] ${label}${colors.reset}`;
  });

  console.log(` ${tabs.join("    ")}\n`);

  // 4. Proposed Commit Box
  if (activeVariant) {
    const subject = sanitizeTerminalString(activeVariant.subject);
    const body = activeVariant.body ? sanitizeTerminalString(activeVariant.body) : "";

    console.log(`   ┌${"─".repeat(60)}┐`);
    console.log(`   │ ${colors.bold}${subject.padEnd(58)}${colors.reset} │`);

    if (body) {
      console.log(`   │${" ".repeat(60)}│`);
      const lines = body.split("\n");
      for (const line of lines) {
        console.log(`   │ ${line.padEnd(58)} │`);
      }
    }
    console.log(`   └${"─".repeat(60)}┘\n`);
  }

  // Validation feedback
  if (options.validationErrors && options.validationErrors.length > 0) {
    console.log(` ${colors.red}Validation Errors:${colors.reset}`);
    for (const err of options.validationErrors) {
      console.log(`  • ${colors.red}${sanitizeTerminalString(err)}${colors.reset}`);
    }
    console.log("");
  }

  if (options.validationWarnings && options.validationWarnings.length > 0) {
    console.log(` ${colors.yellow}Warnings:${colors.reset}`);
    for (const warn of options.validationWarnings) {
      console.log(`  • ${colors.yellow}${sanitizeTerminalString(warn)}${colors.reset}`);
    }
    console.log("");
  }

  // Reasoning evidence (optional toggle)
  if (options.showEvidence && activeVariant?.proposal.evidence) {
    const reasons = [
      ...activeVariant.proposal.evidence.typeReasons,
      ...activeVariant.proposal.evidence.scopeReasons,
    ];
    console.log(` ${colors.bold}Evidence:${colors.reset}`);
    for (const r of reasons) {
      console.log(`  • ${colors.dim}${sanitizeTerminalString(r)}${colors.reset}`);
    }
  }

  // Status or feedback message
  if (options.statusMessage) {
    console.log(
      `\n ${colors.green}✓ ${sanitizeTerminalString(options.statusMessage)}${colors.reset}`,
    );
  }

  if (options.errorMessage) {
    console.log(`\n ${colors.red}✕ ${sanitizeTerminalString(options.errorMessage)}${colors.reset}`);
  }

  // 5. Contextual Action Bar
  console.log(`\n${"─".repeat(64)}`);
  console.log(
    ` ${colors.bold}[Enter]${colors.reset} Commit    ` +
      `${colors.bold}[1-3]${colors.reset} Variant   ` +
      `${colors.bold}[i]${colors.reset} Work item ` +
      `${colors.bold}[e]${colors.reset} Edit      ` +
      `${colors.bold}[t]${colors.reset} Type`,
  );
  console.log(
    ` ${colors.bold}[s]${colors.reset} Scope       ` +
      `${colors.bold}[b]${colors.reset} Breaking  ` +
      `${colors.bold}[r]${colors.reset} Regenerate ` +
      `${colors.bold}[a]${colors.reset} Re-analyze ` +
      `${colors.bold}[d]${colors.reset} Details`,
  );
  console.log(
    ` ${colors.bold}[p]${colors.reset} Patch/Plan  ` +
      `${colors.bold}[c]${colors.reset} Copy       ` +
      `${colors.bold}[q]${colors.reset} Cancel\n`,
  );
}
