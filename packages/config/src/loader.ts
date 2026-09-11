import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type CommitPolicy,
  type ConfigOverrides,
  DEFAULT_COMMIT_CONFIG,
  DEFAULT_COMPOSER_CONFIG,
  DEFAULT_HISTORY_CONFIG,
  DEFAULT_HOOKS_CONFIG,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OPENAI_COMPAT_BASE_URL,
  DEFAULT_OPENAI_COMPAT_MODEL,
  DEFAULT_PLANNING_CONFIG,
  DEFAULT_PRIVACY_CONFIG,
  DEFAULT_WORK_ITEMS_CONFIG,
  type GitWhisperConfig,
  type HooksConfig,
  type PrivacyActionPolicy,
  type PrivacyConfig,
  type ProviderType,
  type ResolvedConfig,
  type WorkItemProviderConfig,
} from "./schema.js";

/**
 * Resolves the configuration directory and file path for the current OS.
 */
export function getConfigPath(): string {
  if (process.env.GITWHISPER_CONFIG_FILE) {
    return path.resolve(process.env.GITWHISPER_CONFIG_FILE);
  }

  const isWindows = process.platform === "win32";
  const baseDir =
    isWindows && process.env.APPDATA
      ? path.join(process.env.APPDATA, "gitwhisper")
      : path.join(os.homedir(), ".config", "gitwhisper");

  return path.join(baseDir, "config.json");
}

/**
 * Reads the stored configuration file from disk if present.
 */
export async function readConfigFile(): Promise<{
  config: Partial<GitWhisperConfig>;
  exists: boolean;
}> {
  const filePath = getConfigPath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { config: parsed, exists: true };
  } catch {
    return { config: {}, exists: false };
  }
}

export class InvalidConfigError extends Error {
  readonly errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "InvalidConfigError";
    this.errors = errors;
  }
}

/**
 * Validates team/repository configuration against schema rules.
 */
export function validateRepositoryConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, errors: ["Configuration must be a JSON object."] };
  }

  const c = config as Record<string, any>;

  // Validate commit section
  if (c.commit !== undefined) {
    if (typeof c.commit !== "object" || c.commit === null || Array.isArray(c.commit)) {
      errors.push("commit must be an object.");
    } else {
      if (c.commit.maxSubjectLength !== undefined) {
        if (
          typeof c.commit.maxSubjectLength !== "number" ||
          !Number.isInteger(c.commit.maxSubjectLength) ||
          c.commit.maxSubjectLength <= 0
        ) {
          errors.push("commit.maxSubjectLength must be a positive integer.");
        }
      }
      if (c.commit.style !== undefined) {
        if (!["auto", "conventional", "simple"].includes(c.commit.style)) {
          errors.push('commit.style must be "auto", "conventional", or "simple".');
        }
      }
      if (c.commit.allowedTypes !== undefined && !Array.isArray(c.commit.allowedTypes)) {
        errors.push("commit.allowedTypes must be an array of strings.");
      }
      if (c.commit.scopes !== undefined && !Array.isArray(c.commit.scopes)) {
        errors.push("commit.scopes must be an array of strings.");
      }
      if (c.commit.requiredScopes !== undefined && !Array.isArray(c.commit.requiredScopes)) {
        errors.push("commit.requiredScopes must be an array of strings.");
      }
      if (c.commit.requireScope !== undefined && typeof c.commit.requireScope !== "boolean") {
        errors.push("commit.requireScope must be a boolean.");
      }
      if (c.commit.strictScopes !== undefined && typeof c.commit.strictScopes !== "boolean") {
        errors.push("commit.strictScopes must be a boolean.");
      }
      if (c.commit.requireWorkItem !== undefined && typeof c.commit.requireWorkItem !== "boolean") {
        errors.push("commit.requireWorkItem must be a boolean.");
      }
    }
  }

  // Validate hooks section
  if (c.hooks !== undefined) {
    if (typeof c.hooks !== "object" || c.hooks === null || Array.isArray(c.hooks)) {
      errors.push("hooks must be an object.");
    } else {
      if (c.hooks.commitMsg !== undefined) {
        if (!["off", "warn", "strict"].includes(c.hooks.commitMsg)) {
          errors.push('hooks.commitMsg must be "off", "warn", or "strict".');
        }
      }
    }
  }

  // Validate workItems section
  if (c.workItems !== undefined) {
    if (typeof c.workItems !== "object" || c.workItems === null || Array.isArray(c.workItems)) {
      errors.push("workItems must be an object.");
    } else {
      const refMode = c.workItems.referenceMode ?? c.workItems.defaultReferenceMode;
      if (refMode !== undefined && !["none", "reference", "close"].includes(refMode)) {
        errors.push('workItems.referenceMode must be "none", "reference", or "close".');
      }
      if (c.workItems.required !== undefined && typeof c.workItems.required !== "boolean") {
        errors.push("workItems.required must be a boolean.");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Reads repository-level configuration from disk if present.
 */
export async function readRepoConfigFile(repoRoot: string): Promise<{
  config: Partial<GitWhisperConfig>;
  exists: boolean;
  filePath?: string;
  errors?: string[];
}> {
  const candidates = [
    path.join(repoRoot, ".gitwhisper.json"),
    path.join(repoRoot, ".gitwhisperrc.json"),
    path.join(repoRoot, ".gitwhisperrc"),
    path.join(repoRoot, ".gitwhisper", "config.json"),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err: any) {
        return {
          config: {},
          exists: true,
          filePath: candidate,
          errors: [`Invalid JSON in repository configuration file: ${err.message}`],
        };
      }
      const validation = validateRepositoryConfig(parsed);
      if (!validation.valid) {
        return {
          config: parsed as Partial<GitWhisperConfig>,
          exists: true,
          filePath: candidate,
          errors: validation.errors,
        };
      }
      return { config: parsed as Partial<GitWhisperConfig>, exists: true, filePath: candidate };
    } catch {
      // Continue to next candidate
    }
  }

  return { config: {}, exists: false };
}

/**
 * Enforces strict privacy precedence:
 * Repository-level configuration CANNOT silently weaken user-global privacy protections.
 */
export function enforceStrictPrivacyPolicy(
  globalPrivacy: Partial<PrivacyConfig> | undefined,
  repoPrivacy: Partial<PrivacyConfig> | undefined,
): Partial<PrivacyConfig> {
  if (!repoPrivacy) {
    return globalPrivacy ?? {};
  }

  const effectiveGlobal: Partial<PrivacyConfig> = {
    ...DEFAULT_PRIVACY_CONFIG,
    ...globalPrivacy,
    remote: {
      ...DEFAULT_PRIVACY_CONFIG.remote,
      ...globalPrivacy?.remote,
    },
    local: {
      ...DEFAULT_PRIVACY_CONFIG.local,
      ...globalPrivacy?.local,
    },
  };

  const result: Partial<PrivacyConfig> = { ...repoPrivacy };

  // Rule 1: If global/default enabled scanning, repo cannot disable it
  if (effectiveGlobal.scanSecrets === true && repoPrivacy.scanSecrets === false) {
    result.scanSecrets = true;
  } else if (effectiveGlobal.scanSecrets !== undefined) {
    result.scanSecrets = repoPrivacy.scanSecrets ?? effectiveGlobal.scanSecrets;
  }

  // Action severity order: block (3) > redact (2) > warn (1) > ignore (0)
  const severityMap: Record<string, number> = {
    block: 3,
    redact: 2,
    warn: 1,
    ignore: 0,
  };

  const mergeAction = <T extends string>(
    globalAction: T | undefined,
    repoAction: T | undefined,
  ): T | undefined => {
    if (!globalAction) return repoAction;
    if (!repoAction) return globalAction;
    const globalSev = severityMap[globalAction] ?? 0;
    const repoSev = severityMap[repoAction] ?? 0;
    // Cannot downgrade severity below global
    return repoSev < globalSev ? globalAction : repoAction;
  };

  if (effectiveGlobal.remote || repoPrivacy.remote) {
    result.remote = {
      highConfidence: mergeAction(
        effectiveGlobal.remote?.highConfidence,
        repoPrivacy.remote?.highConfidence,
      ),
      mediumConfidence: mergeAction(
        effectiveGlobal.remote?.mediumConfidence,
        repoPrivacy.remote?.mediumConfidence,
      ),
      lowConfidence: mergeAction(
        effectiveGlobal.remote?.lowConfidence,
        repoPrivacy.remote?.lowConfidence,
      ),
    };
  }

  if (effectiveGlobal.local || repoPrivacy.local) {
    result.local = {
      highConfidence: mergeAction(
        effectiveGlobal.local?.highConfidence,
        repoPrivacy.local?.highConfidence,
      ),
      mediumConfidence: mergeAction(
        effectiveGlobal.local?.mediumConfidence,
        repoPrivacy.local?.mediumConfidence,
      ),
      lowConfidence: mergeAction(
        effectiveGlobal.local?.lowConfidence,
        repoPrivacy.local?.lowConfidence,
      ),
    };
  }

  // Data minimization: If global is false, repo cannot send it to remote
  if (effectiveGlobal.sendBranchName === false && repoPrivacy.sendBranchName === true) {
    result.sendBranchName = false;
  }
  if (effectiveGlobal.sendRepositoryName === false && repoPrivacy.sendRepositoryName === true) {
    result.sendRepositoryName = false;
  }
  if (effectiveGlobal.sendCommitExamples === false && repoPrivacy.sendCommitExamples === true) {
    result.sendCommitExamples = false;
  }

  // Custom patterns and ignore rules combine additively
  result.customPatterns = [
    ...(effectiveGlobal.customPatterns ?? []),
    ...(repoPrivacy.customPatterns ?? []),
  ];
  result.ignore = [...(effectiveGlobal.ignore ?? []), ...(repoPrivacy.ignore ?? [])];

  return result;
}

/**
 * Saves or updates configuration to disk.
 */
export async function saveConfig(updates: Partial<GitWhisperConfig>): Promise<string> {
  const filePath = getConfigPath();
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const existing = (await readConfigFile()).config;
  const merged: GitWhisperConfig = {
    provider: updates.provider ?? existing.provider ?? "ollama",
    model:
      updates.model ??
      existing.model ??
      (updates.provider === "openai-compatible"
        ? DEFAULT_OPENAI_COMPAT_MODEL
        : DEFAULT_OLLAMA_MODEL),
    commit: {
      ...existing.commit,
      ...updates.commit,
    },
    history: {
      ...existing.history,
      ...updates.history,
    },
    planning: {
      ...existing.planning,
      ...updates.planning,
    },
    composer: {
      ...existing.composer,
      ...updates.composer,
    },
    privacy: {
      ...existing.privacy,
      ...updates.privacy,
    },
    workItems: {
      ...existing.workItems,
      ...updates.workItems,
    },
    providers: {
      ollama: {
        baseUrl:
          updates.providers?.ollama?.baseUrl ??
          existing.providers?.ollama?.baseUrl ??
          DEFAULT_OLLAMA_BASE_URL,
      },
      "openai-compatible": {
        baseUrl:
          updates.providers?.["openai-compatible"]?.baseUrl ??
          existing.providers?.["openai-compatible"]?.baseUrl ??
          DEFAULT_OPENAI_COMPAT_BASE_URL,
        ...(updates.providers?.["openai-compatible"]?.apiKey
          ? { apiKey: updates.providers["openai-compatible"].apiKey }
          : {}),
      },
    },
  };

  await fs.writeFile(filePath, JSON.stringify(merged, null, 2), "utf8");
  return filePath;
}

/**
 * Loads and resolves the active configuration by merging CLI flags,
 * environment variables, repository config, stored global config, and defaults.
 */
export async function loadConfig(
  overrides: ConfigOverrides = {},
  repoRoot?: string,
): Promise<ResolvedConfig> {
  const { config: fileConfig, exists } = await readConfigFile();
  const configPath = getConfigPath();

  // Read repository config if repoRoot provided or discovered
  let repoConfig: Partial<GitWhisperConfig> = {};
  if (repoRoot) {
    const repoRes = await readRepoConfigFile(repoRoot);
    if (repoRes.exists) {
      if (repoRes.errors && repoRes.errors.length > 0) {
        throw new InvalidConfigError(
          `Invalid GitWhisper configuration in ${repoRes.filePath}:\n${repoRes.errors.map((e) => `• ${e}`).join("\n")}`,
          repoRes.errors,
        );
      }
      repoConfig = repoRes.config;
    }
  }

  // 1. Resolve Provider
  const envProvider = process.env.GITWHISPER_PROVIDER as ProviderType | undefined;
  const provider: ProviderType =
    overrides.provider || envProvider || repoConfig.provider || fileConfig.provider || "ollama";

  // 2. Resolve Model
  const envModel = process.env.GITWHISPER_MODEL;
  const fileModel = fileConfig.model;
  const repoModel = repoConfig.model;
  const defaultModel = provider === "ollama" ? DEFAULT_OLLAMA_MODEL : DEFAULT_OPENAI_COMPAT_MODEL;
  const model = overrides.model || envModel || repoModel || fileModel || defaultModel;

  // 3. Resolve Base URL & API Key
  const envBaseUrl = process.env.GITWHISPER_BASE_URL;
  const envApiKey = process.env.GITWHISPER_API_KEY || process.env.OPENAI_API_KEY;

  let baseUrl: string;
  let apiKey: string | undefined;

  if (provider === "ollama") {
    baseUrl =
      overrides.baseUrl ||
      envBaseUrl ||
      repoConfig.providers?.ollama?.baseUrl ||
      fileConfig.providers?.ollama?.baseUrl ||
      DEFAULT_OLLAMA_BASE_URL;
  } else {
    baseUrl =
      overrides.baseUrl ||
      envBaseUrl ||
      repoConfig.providers?.["openai-compatible"]?.baseUrl ||
      fileConfig.providers?.["openai-compatible"]?.baseUrl ||
      DEFAULT_OPENAI_COMPAT_BASE_URL;

    apiKey =
      overrides.apiKey ||
      envApiKey ||
      repoConfig.providers?.["openai-compatible"]?.apiKey ||
      fileConfig.providers?.["openai-compatible"]?.apiKey;
  }

  // Remove trailing slashes from baseUrl for clean endpoint concatenation
  baseUrl = baseUrl.replace(/\/+$/, "");

  // 4. Resolve Commit Configuration
  const fileCommit = fileConfig.commit || {};
  const repoCommit = repoConfig.commit || {};
  const overrideCommit = overrides.commit || {};

  const commit = {
    style:
      overrideCommit.style ?? repoCommit.style ?? fileCommit.style ?? DEFAULT_COMMIT_CONFIG.style,
    maxSubjectLength:
      overrideCommit.maxSubjectLength ??
      repoCommit.maxSubjectLength ??
      fileCommit.maxSubjectLength ??
      DEFAULT_COMMIT_CONFIG.maxSubjectLength,
    requireScope:
      overrideCommit.requireScope ??
      repoCommit.requireScope ??
      fileCommit.requireScope ??
      DEFAULT_COMMIT_CONFIG.requireScope,
    body: overrideCommit.body ?? repoCommit.body ?? fileCommit.body ?? DEFAULT_COMMIT_CONFIG.body,
    allowedTypes:
      overrideCommit.allowedTypes ??
      repoCommit.allowedTypes ??
      fileCommit.allowedTypes ??
      DEFAULT_COMMIT_CONFIG.allowedTypes,
    scopes: overrideCommit.scopes ?? repoCommit.scopes ?? fileCommit.scopes,
    requiredScopes:
      overrideCommit.requiredScopes ?? repoCommit.requiredScopes ?? fileCommit.requiredScopes,
    strictScopes:
      overrideCommit.strictScopes ??
      repoCommit.strictScopes ??
      fileCommit.strictScopes ??
      DEFAULT_COMMIT_CONFIG.strictScopes,
    allowVagueDescriptions:
      overrideCommit.allowVagueDescriptions ??
      repoCommit.allowVagueDescriptions ??
      fileCommit.allowVagueDescriptions ??
      DEFAULT_COMMIT_CONFIG.allowVagueDescriptions,
    requireWorkItem:
      overrideCommit.requireWorkItem ??
      repoCommit.requireWorkItem ??
      fileCommit.requireWorkItem ??
      DEFAULT_COMMIT_CONFIG.requireWorkItem,
  };

  // 5. Resolve History Configuration
  const fileHistory = fileConfig.history || {};
  const repoHistory = repoConfig.history || {};
  const overrideHistory = overrides.history || {};

  const history = {
    enabled:
      overrideHistory.enabled ??
      repoHistory.enabled ??
      fileHistory.enabled ??
      DEFAULT_HISTORY_CONFIG.enabled,
    limit:
      overrideHistory.limit ??
      repoHistory.limit ??
      fileHistory.limit ??
      DEFAULT_HISTORY_CONFIG.limit,
    includeMergeCommits:
      overrideHistory.includeMergeCommits ??
      repoHistory.includeMergeCommits ??
      fileHistory.includeMergeCommits ??
      DEFAULT_HISTORY_CONFIG.includeMergeCommits,
    sendExamplesToAI:
      overrideHistory.sendExamplesToAI ??
      repoHistory.sendExamplesToAI ??
      fileHistory.sendExamplesToAI ??
      DEFAULT_HISTORY_CONFIG.sendExamplesToAI,
    minimumSampleSize:
      overrideHistory.minimumSampleSize ??
      repoHistory.minimumSampleSize ??
      fileHistory.minimumSampleSize ??
      DEFAULT_HISTORY_CONFIG.minimumSampleSize,
    learnScopes:
      overrideHistory.learnScopes ??
      repoHistory.learnScopes ??
      fileHistory.learnScopes ??
      DEFAULT_HISTORY_CONFIG.learnScopes,
    learnFormatting:
      overrideHistory.learnFormatting ??
      repoHistory.learnFormatting ??
      fileHistory.learnFormatting ??
      DEFAULT_HISTORY_CONFIG.learnFormatting,
  };

  // 6. Resolve Planning Configuration
  const filePlanning = fileConfig.planning || {};
  const repoPlanning = repoConfig.planning || {};
  const overridePlanning = overrides.planning || {};

  const planning = {
    enabled:
      overridePlanning.enabled ??
      repoPlanning.enabled ??
      filePlanning.enabled ??
      DEFAULT_PLANNING_CONFIG.enabled,
    suggestSplit:
      overridePlanning.suggestSplit ??
      repoPlanning.suggestSplit ??
      filePlanning.suggestSplit ??
      DEFAULT_PLANNING_CONFIG.suggestSplit,
    minimumConfidence:
      overridePlanning.minimumConfidence ??
      repoPlanning.minimumConfidence ??
      filePlanning.minimumConfidence ??
      DEFAULT_PLANNING_CONFIG.minimumConfidence,
    maxFilesForSemanticAnalysis:
      overridePlanning.maxFilesForSemanticAnalysis ??
      repoPlanning.maxFilesForSemanticAnalysis ??
      filePlanning.maxFilesForSemanticAnalysis ??
      DEFAULT_PLANNING_CONFIG.maxFilesForSemanticAnalysis,
    allowFileLevelSplitting:
      overridePlanning.allowFileLevelSplitting ??
      repoPlanning.allowFileLevelSplitting ??
      filePlanning.allowFileLevelSplitting ??
      DEFAULT_PLANNING_CONFIG.allowFileLevelSplitting,
    allowHunkLevelSplitting:
      overridePlanning.allowHunkLevelSplitting ??
      repoPlanning.allowHunkLevelSplitting ??
      filePlanning.allowHunkLevelSplitting ??
      DEFAULT_PLANNING_CONFIG.allowHunkLevelSplitting,
  };

  // 7. Resolve Composer Configuration
  const fileComposer = fileConfig.composer || {};
  const repoComposer = repoConfig.composer || {};
  const overrideComposer = overrides.composer || {};

  const composer = {
    defaultVariant:
      overrideComposer.defaultVariant ??
      repoComposer.defaultVariant ??
      fileComposer.defaultVariant ??
      DEFAULT_COMPOSER_CONFIG.defaultVariant,
    showEvidence:
      overrideComposer.showEvidence ??
      repoComposer.showEvidence ??
      fileComposer.showEvidence ??
      DEFAULT_COMPOSER_CONFIG.showEvidence,
    showProvider:
      overrideComposer.showProvider ??
      repoComposer.showProvider ??
      fileComposer.showProvider ??
      DEFAULT_COMPOSER_CONFIG.showProvider,
    confirmBeforeCommit:
      overrideComposer.confirmBeforeCommit ??
      repoComposer.confirmBeforeCommit ??
      fileComposer.confirmBeforeCommit ??
      DEFAULT_COMPOSER_CONFIG.confirmBeforeCommit,
    confirmBeforeMultiCommit:
      overrideComposer.confirmBeforeMultiCommit ??
      repoComposer.confirmBeforeMultiCommit ??
      fileComposer.confirmBeforeMultiCommit ??
      DEFAULT_COMPOSER_CONFIG.confirmBeforeMultiCommit,
    color:
      overrideComposer.color ??
      repoComposer.color ??
      fileComposer.color ??
      DEFAULT_COMPOSER_CONFIG.color,
    editor:
      overrideComposer.editor ??
      repoComposer.editor ??
      fileComposer.editor ??
      DEFAULT_COMPOSER_CONFIG.editor,
  };

  // 8. Resolve Privacy Configuration with Strict Precedence
  const filePrivacy = fileConfig.privacy || {};
  const repoPrivacy = repoConfig.privacy || {};
  const mergedRepoPrivacy = enforceStrictPrivacyPolicy(filePrivacy, repoPrivacy);
  const overridePrivacy = overrides.privacy || {};

  const privacy: ResolvedConfig["privacy"] = {
    scanSecrets:
      overridePrivacy.scanSecrets ??
      mergedRepoPrivacy.scanSecrets ??
      DEFAULT_PRIVACY_CONFIG.scanSecrets,
    remote: {
      highConfidence:
        overridePrivacy.remote?.highConfidence ??
        mergedRepoPrivacy.remote?.highConfidence ??
        DEFAULT_PRIVACY_CONFIG.remote.highConfidence,
      mediumConfidence:
        overridePrivacy.remote?.mediumConfidence ??
        mergedRepoPrivacy.remote?.mediumConfidence ??
        DEFAULT_PRIVACY_CONFIG.remote.mediumConfidence,
      lowConfidence:
        overridePrivacy.remote?.lowConfidence ??
        mergedRepoPrivacy.remote?.lowConfidence ??
        DEFAULT_PRIVACY_CONFIG.remote.lowConfidence,
    },
    local: {
      highConfidence:
        overridePrivacy.local?.highConfidence ??
        mergedRepoPrivacy.local?.highConfidence ??
        DEFAULT_PRIVACY_CONFIG.local.highConfidence,
      mediumConfidence:
        overridePrivacy.local?.mediumConfidence ??
        mergedRepoPrivacy.local?.mediumConfidence ??
        DEFAULT_PRIVACY_CONFIG.local.mediumConfidence,
      lowConfidence:
        overridePrivacy.local?.lowConfidence ??
        mergedRepoPrivacy.local?.lowConfidence ??
        DEFAULT_PRIVACY_CONFIG.local.lowConfidence,
    },
    sendBranchName:
      overridePrivacy.sendBranchName ??
      mergedRepoPrivacy.sendBranchName ??
      DEFAULT_PRIVACY_CONFIG.sendBranchName,
    sendRepositoryName:
      overridePrivacy.sendRepositoryName ??
      mergedRepoPrivacy.sendRepositoryName ??
      DEFAULT_PRIVACY_CONFIG.sendRepositoryName,
    sendCommitExamples:
      overridePrivacy.sendCommitExamples ??
      mergedRepoPrivacy.sendCommitExamples ??
      DEFAULT_PRIVACY_CONFIG.sendCommitExamples,
    customPatterns: [
      ...(mergedRepoPrivacy.customPatterns ?? []),
      ...(overridePrivacy.customPatterns ?? []),
    ],
    ignore: [...(mergedRepoPrivacy.ignore ?? []), ...(overridePrivacy.ignore ?? [])],
    maxScanSizeBytes:
      overridePrivacy.maxScanSizeBytes ??
      mergedRepoPrivacy.maxScanSizeBytes ??
      DEFAULT_PRIVACY_CONFIG.maxScanSizeBytes,
  };

  // 9. Resolve Work Items Configuration
  const fileWorkItems = fileConfig.workItems || {};
  const repoWorkItems = repoConfig.workItems || {};
  const overrideWorkItems = overrides.workItems || {};

  // Security: Repo config CANNOT inject arbitrary tokens
  const safeRepoProviders: Record<string, WorkItemProviderConfig> = {};
  if (repoWorkItems.providers) {
    for (const [key, val] of Object.entries(repoWorkItems.providers)) {
      safeRepoProviders[key] = {
        provider: val.provider,
        baseUrl: val.baseUrl,
        project: val.project,
      };
    }
  }

  const mergedProviders: Record<string, WorkItemProviderConfig> = {
    ...fileWorkItems.providers,
    ...safeRepoProviders,
  };

  if (fileWorkItems.providers) {
    for (const [key, val] of Object.entries(fileWorkItems.providers)) {
      if (mergedProviders[key] && val.token) {
        mergedProviders[key].token = val.token;
      }
    }
  }

  const workItems: ResolvedConfig["workItems"] = {
    enabled:
      overrideWorkItems.enabled ??
      repoWorkItems.enabled ??
      fileWorkItems.enabled ??
      DEFAULT_WORK_ITEMS_CONFIG.enabled,
    autoDetectFromBranch:
      overrideWorkItems.autoDetectFromBranch ??
      repoWorkItems.autoDetectFromBranch ??
      fileWorkItems.autoDetectFromBranch ??
      DEFAULT_WORK_ITEMS_CONFIG.autoDetectFromBranch,
    autoFetch:
      overrideWorkItems.autoFetch ??
      repoWorkItems.autoFetch ??
      fileWorkItems.autoFetch ??
      DEFAULT_WORK_ITEMS_CONFIG.autoFetch,
    defaultReferenceMode:
      overrideWorkItems.defaultReferenceMode ??
      repoWorkItems.defaultReferenceMode ??
      fileWorkItems.defaultReferenceMode ??
      DEFAULT_WORK_ITEMS_CONFIG.defaultReferenceMode,
    referenceKeyword:
      overrideWorkItems.referenceKeyword ??
      repoWorkItems.referenceKeyword ??
      fileWorkItems.referenceKeyword ??
      DEFAULT_WORK_ITEMS_CONFIG.referenceKeyword,
    closingKeyword:
      overrideWorkItems.closingKeyword ??
      repoWorkItems.closingKeyword ??
      fileWorkItems.closingKeyword ??
      DEFAULT_WORK_ITEMS_CONFIG.closingKeyword,
    placement:
      overrideWorkItems.placement ??
      repoWorkItems.placement ??
      fileWorkItems.placement ??
      DEFAULT_WORK_ITEMS_CONFIG.placement,
    patterns: [
      ...(fileWorkItems.patterns ?? []),
      ...(repoWorkItems.patterns ?? []),
      ...(overrideWorkItems.patterns ?? []),
    ],
    providers: mergedProviders,
    trustedHosts: [
      ...(fileWorkItems.trustedHosts ?? []),
      ...(overrideWorkItems.trustedHosts ?? []),
    ],
  };

  // 10. Resolve Hooks Configuration
  const fileHooks = fileConfig.hooks || {};
  const repoHooks = repoConfig.hooks || {};
  const overrideHooks = overrides.hooks || {};

  const hooks = {
    commitMsg:
      overrideHooks.commitMsg ??
      repoHooks.commitMsg ??
      fileHooks.commitMsg ??
      DEFAULT_HOOKS_CONFIG.commitMsg,
  };

  const isConfigured =
    exists || Boolean(envProvider || envModel || overrides.provider || overrides.model);

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    commit,
    history,
    planning,
    composer,
    hooks,
    privacy,
    workItems,
    isConfigured,
    configFilePath: configPath,
  };
}

/**
 * Resolves the centralized team commit policy from resolved configuration,
 * learned repository style, and optional CLI overrides.
 * Precedence: CLI override > Global config > Repo config (.gitwhisper.json) > Learned style > Defaults.
 */
export function resolveCommitPolicy(
  resolved: ResolvedConfig,
  repoStyle?: { conventionStyle?: string; commonScopes?: Array<{ scope: string }> },
  overrides?: Partial<CommitPolicy>,
): CommitPolicy {
  let effectiveStyle = resolved.commit.style;
  if (effectiveStyle === "auto") {
    if (repoStyle?.conventionStyle === "simple") {
      effectiveStyle = "simple";
    } else if (repoStyle?.conventionStyle === "conventional") {
      effectiveStyle = "conventional";
    } else {
      effectiveStyle = "conventional";
    }
  }

  const allowedTypes = overrides?.allowedTypes ?? resolved.commit.allowedTypes;
  const scopes = overrides?.scopes ?? resolved.commit.scopes;
  const requiredScopes = overrides?.requiredScopes ?? resolved.commit.requiredScopes;
  const strictScopes = overrides?.strictScopes ?? resolved.commit.strictScopes;
  const maxSubjectLength = overrides?.maxSubjectLength ?? resolved.commit.maxSubjectLength;
  const requireScope = overrides?.requireScope ?? resolved.commit.requireScope;
  const requireWorkItem =
    overrides?.requireWorkItem ??
    resolved.commit.requireWorkItem ??
    (resolved.workItems.enabled && Boolean((resolved.workItems as any).required));
  const workItemMode =
    overrides?.workItemMode ??
    (resolved.workItems.defaultReferenceMode === "none" ? "none" : "reference");
  const allowVagueDescriptions =
    overrides?.allowVagueDescriptions ?? resolved.commit.allowVagueDescriptions;

  return {
    style: overrides?.style ?? effectiveStyle,
    allowedTypes,
    scopes,
    requiredScopes,
    strictScopes,
    maxSubjectLength,
    requireScope,
    requireWorkItem,
    workItemMode,
    allowVagueDescriptions,
  };
}
