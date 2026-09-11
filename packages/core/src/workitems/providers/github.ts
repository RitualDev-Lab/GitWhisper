import { normalizeHost, safeFetch } from "../security.js";
import type {
  WorkItem,
  WorkItemProvider,
  WorkItemProviderValidation,
  WorkItemReference,
  WorkItemResolution,
} from "../types.js";

export interface GitHubProviderOptions {
  baseUrl?: string; // Default: https://api.github.com
  token?: string;
  owner?: string;
  repo?: string;
}

export class GitHubWorkItemProvider implements WorkItemProvider {
  public readonly id = "github" as const;
  private baseUrl: string;
  private token?: string;
  private owner?: string;
  private repo?: string;

  constructor(options: GitHubProviderOptions = {}) {
    this.baseUrl = (options.baseUrl || "https://api.github.com").replace(/\/$/, "");
    this.token = options.token || process.env.GITWHISPER_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    this.owner = options.owner;
    this.repo = options.repo;
  }

  public async validateConfiguration(): Promise<WorkItemProviderValidation> {
    if (!this.owner || !this.repo) {
      return {
        valid: false,
        error:
          "GitHub repository owner and name could not be resolved from Git remotes or configuration.",
      };
    }
    return { valid: true };
  }

  public async resolve(
    reference: WorkItemReference,
    signal?: AbortSignal,
  ): Promise<WorkItemResolution> {
    // Extract issue number from key (e.g. #123, GH-123, 123)
    const numMatch = reference.key.match(/\d+/);
    if (!numMatch) {
      return {
        found: false,
        error: `Could not parse issue number from reference key "${reference.key}".`,
      };
    }

    const issueNumber = numMatch[0];
    const validation = await this.validateConfiguration();
    if (!validation.valid) {
      return { found: false, error: validation.error };
    }

    const targetUrl = `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${issueNumber}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitWhisper/0.8.0",
    };

    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }

    try {
      const allowedHost = normalizeHost(this.baseUrl);
      const res = await safeFetch(targetUrl, {
        method: "GET",
        headers,
        signal,
        allowedHost,
        hasCredentials: Boolean(this.token),
      });

      if (res.status === 404) {
        return {
          found: false,
          error: `GitHub issue #${issueNumber} not found in ${this.owner}/${this.repo}.`,
        };
      }

      if (res.status === 401 || res.status === 403) {
        if (res.headers.get("x-ratelimit-remaining") === "0") {
          return {
            found: false,
            error: "GitHub API rate limit exceeded.",
          };
        }
        return {
          found: false,
          error: "GitHub API authentication failed or permission denied.",
        };
      }

      if (!res.ok) {
        return {
          found: false,
          error: `GitHub API error: HTTP ${res.status} ${res.statusText}`,
        };
      }

      const data = (await res.json()) as {
        title?: string;
        body?: string;
        state?: string;
        html_url?: string;
        labels?: Array<{ name: string } | string>;
      };

      const labels = (data.labels || []).map((l) => (typeof l === "string" ? l : l.name));

      const workItem: WorkItem = {
        provider: "github",
        key: `#${issueNumber}`,
        title: data.title,
        description: data.body ?? undefined,
        state: data.state,
        url: data.html_url,
        labels,
        project: `${this.owner}/${this.repo}`,
        fetchedAt: new Date().toISOString(),
      };

      return {
        found: true,
        workItem,
      };
    } catch (err: unknown) {
      return {
        found: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
