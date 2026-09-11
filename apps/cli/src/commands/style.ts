import {
  analyzeRepositoryHistory,
  computeHistoryCacheKey,
  getCachedHistoryProfile,
  setCachedHistoryProfile,
} from "@gitwhisper/core";
import { findRepository, getCommitHistory, isShallowRepository } from "@gitwhisper/git";
import { colors, printHeader } from "../ui/terminal.js";

export interface StyleCommandOptions {
  limit?: number;
  json?: boolean;
  details?: boolean;
  noCache?: boolean;
}

export async function runStyle(options: StyleCommandOptions = {}): Promise<void> {
  const repoRoot = await findRepository();

  if (!repoRoot) {
    printHeader();
    console.error(` ${colors.red}Error: Not inside a Git repository.${colors.reset}\n`);
    console.error(" Initialize a repository first:\n   git init\n");
    process.exit(1);
  }

  const limit = options.limit ?? 50;

  // Check cache unless --noCache is set
  let profile = null;
  const isShallow = await isShallowRepository(repoRoot);

  if (!options.noCache) {
    const cacheKey = computeHistoryCacheKey(repoRoot, null, `limit=${limit}`);
    profile = await getCachedHistoryProfile(cacheKey);
  }

  if (!profile) {
    const commits = await getCommitHistory(repoRoot, {
      limit,
      includeMerges: true,
      withFiles: true,
    });

    profile = analyzeRepositoryHistory(commits, {
      minimumSampleSize: 5,
      includeMergeCommits: false,
      isShallow,
    });

    if (!options.noCache && commits.length > 0) {
      const head = commits[0]?.hash ?? null;
      const cacheKey = computeHistoryCacheKey(repoRoot, head, `limit=${limit}`);
      await setCachedHistoryProfile(cacheKey, profile);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }

  printHeader();
  console.log(` ${colors.bold}${colors.cyan}GitWhisper Repository Style${colors.reset}\n`);

  if (profile.sampleSize === 0) {
    console.log(` ${colors.yellow}No commit history available.${colors.reset}`);
    console.log(" GitWhisper will use configured/default style.\n");
    return;
  }

  if (profile.convention.confidence === "LOW") {
    console.log(` Analyzed       ${profile.sampleSize} commits`);
    if (profile.ignoredMerges > 0) {
      console.log(` Ignored        ${profile.ignoredMerges} merge commits`);
    }
    console.log(` Confidence     ${colors.yellow}LOW${colors.reset}\n`);
    console.log(
      ` ${colors.dim}Not enough history to reliably learn this repository's commit convention.${colors.reset}`,
    );
    console.log(` ${colors.dim}GitWhisper will use configured/default style.${colors.reset}\n`);
    return;
  }

  console.log(` Analyzed       ${profile.sampleSize} commits`);
  if (profile.ignoredMerges > 0) {
    console.log(` Ignored        ${profile.ignoredMerges} merge commits`);
  }
  if (profile.isShallow) {
    console.log(" Source         shallow repository (local depth limited)");
  }

  const conventionLabel =
    profile.convention.style === "conventional"
      ? "Conventional Commits"
      : profile.convention.style === "simple"
        ? "Simple / Imperative"
        : "Mixed";

  const confidenceColor =
    profile.convention.confidence === "HIGH"
      ? colors.green
      : profile.convention.confidence === "MEDIUM"
        ? colors.yellow
        : colors.dim;

  const confidenceText =
    profile.convention.confidence === "HIGH"
      ? "High"
      : profile.convention.confidence === "MEDIUM"
        ? "Medium"
        : "Low";

  console.log(`\n Convention     ${colors.bold}${conventionLabel}${colors.reset}`);
  console.log(` Confidence     ${confidenceColor}${confidenceText}${colors.reset}`);

  console.log(`\n ${colors.bold}Subject${colors.reset}`);
  console.log(`   casing       ${profile.formatting.subjectCase}`);
  console.log(`   median       ${profile.formatting.medianSubjectLength} chars`);
  console.log(
    `   period       ${profile.formatting.trailingPeriodFrequency >= 0.5 ? "frequent" : "rarely"}`,
  );

  if (profile.scopes.length > 0) {
    console.log(`\n ${colors.bold}Scopes${colors.reset}`);
    for (const s of profile.scopes.slice(0, 5)) {
      console.log(`   ${s.scope.padEnd(12)} ${s.count}`);
    }
  }

  console.log(`\n ${colors.bold}Bodies${colors.reset}`);
  console.log(`   used         ${Math.round(profile.formatting.bodyUsageFrequency * 100)}%`);

  console.log(`\n ${colors.bold}Emoji${colors.reset}`);
  console.log(
    `   ${profile.features.usesEmoji ? `${colors.green}yes` : `${colors.dim}no`}${colors.reset}`,
  );

  console.log(`\n ${colors.bold}Issue IDs${colors.reset}`);
  console.log(
    `   ${profile.features.usesIssueReferences ? `${colors.green}detected` : `${colors.dim}rare`}${colors.reset}\n`,
  );

  if (options.details) {
    console.log(` ${colors.bold}${colors.cyan}--- Detailed Statistics ---${colors.reset}\n`);
    console.log(` Conventional Ratio: ${Math.round(profile.convention.conventionalRatio * 100)}%`);
    console.log(
      ` Subject Length: avg ${profile.formatting.averageSubjectLength}, max ${profile.formatting.maxObservedSubjectLength}`,
    );

    if (profile.types.length > 0) {
      console.log("\n Types breakdown:");
      for (const t of profile.types) {
        console.log(`   ${t.type.padEnd(12)} ${t.count} (${Math.round(t.frequency * 100)}%)`);
      }
    }

    if (profile.pathScopeMappings.length > 0) {
      console.log("\n Historical Path-to-Scope Mappings:");
      for (const m of profile.pathScopeMappings) {
        console.log(
          `   ${m.pathPrefix.padEnd(24)} -> ${m.scope} (${m.observations} obs, ${m.confidence})`,
        );
      }
    }
    console.log("");
  }
}
