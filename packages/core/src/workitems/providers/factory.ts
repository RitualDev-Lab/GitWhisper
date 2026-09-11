import type { GitRemote } from "@gitwhisper/git";
import type { WorkItemProvider, WorkItemReference } from "../types.js";
import { GenericWorkItemProvider } from "./generic.js";
import { GitHubWorkItemProvider } from "./github.js";
import { JiraWorkItemProvider } from "./jira.js";

export interface WorkItemProviderConfig {
  provider: "github" | "gitlab" | "jira" | "linear" | "generic";
  baseUrl?: string;
  project?: string;
  token?: string;
}

export interface WorkItemsFactoryConfig {
  providers?: Record<string, WorkItemProviderConfig>;
}

export interface ProviderResolutionContext {
  reference: WorkItemReference;
  config?: WorkItemsFactoryConfig;
  remote?: GitRemote;
}

/**
 * Creates the most appropriate WorkItemProvider for the given reference and repository context.
 */
export function createWorkItemProvider(context: ProviderResolutionContext): WorkItemProvider {
  const { reference, config, remote } = context;

  // 1. Check if an explicit provider mapping exists for this issue key prefix
  // e.g. reference "DEV-142" -> prefix "DEV"
  const prefixMatch = reference.key.match(/^([A-Z0-9]+)-/i);
  const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : undefined;

  if (prefix && config?.providers?.[prefix]) {
    const providerCfg = config.providers[prefix];
    if (providerCfg.provider === "jira") {
      return new JiraWorkItemProvider({
        baseUrl: providerCfg.baseUrl,
        token: providerCfg.token,
        project: providerCfg.project ?? prefix,
      });
    }
    if (providerCfg.provider === "github") {
      return new GitHubWorkItemProvider({
        baseUrl: providerCfg.baseUrl,
        token: providerCfg.token,
        owner: remote?.owner,
        repo: remote?.repository,
      });
    }
  }

  // 2. Check for GitHub reference pattern (#123, GH-123)
  const isGithubRef =
    reference.providerHint === "github" ||
    reference.key.startsWith("#") ||
    reference.key.toUpperCase().startsWith("GH-");

  if (isGithubRef) {
    const githubCfg = config?.providers?.github;
    return new GitHubWorkItemProvider({
      baseUrl: githubCfg?.baseUrl,
      token: githubCfg?.token,
      owner: remote?.owner,
      repo: remote?.repository,
    });
  }

  // 3. Check for Jira generic prefix if configured
  if (config?.providers?.jira) {
    const jiraCfg = config.providers.jira;
    return new JiraWorkItemProvider({
      baseUrl: jiraCfg.baseUrl,
      token: jiraCfg.token,
      project: jiraCfg.project,
    });
  }

  // 4. Default to zero-network generic provider
  return new GenericWorkItemProvider();
}
